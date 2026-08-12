// voice.js - PeerJS media calls. V is push-to-talk; routing stays local.

export function shouldInitiateVoice(localPeerId, remotePeerId) {
    return typeof localPeerId === 'string' && localPeerId.length > 0
        && typeof remotePeerId === 'string' && remotePeerId.length > 0
        && localPeerId !== remotePeerId && localPeerId < remotePeerId;
}

export function calculateVoiceSpatialMix(distance, pan, { maxDistance = 80, teamChannel = true, muted = false } = {}) {
    if (muted) return { gain: 0, pan: 0 };
    const safeDistance = Math.max(0, Number.isFinite(distance) ? distance : 0);
    const range = Math.max(1, Number.isFinite(maxDistance) ? maxDistance : 80);
    const falloff = Math.max(0, 1 - safeDistance / range);
    // Team comms must remain intelligible across an arena. FFA proximity voice
    // is allowed to become almost silent at the edge of its 22m target gate.
    const floor = teamChannel ? .35 : .06;
    return {
        gain: Math.min(1, floor + (1 - floor) * falloff * falloff),
        pan: Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0))
    };
}

export class VoiceChat {
    constructor(network) {
        this.network = network;
        this.stream = null;
        this.peers = new Map();
        this.remoteAudio = new Map();
        this.remoteMixers = new Map();
        this.enabled = false;
        this.userMuted = false;
        this.pushToTalk = true;
        this.pttActive = false;
        this.audioContext = null;
        this.analyser = null;
        this.onSpeaking = null;
        this._speakingState = new Map();
        this._targets = new Map();
        this._boundPeer = null;
    }

    async enable() {
        if (this.enabled) return true;
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            this.enabled = true;
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(this.stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            source.connect(this.analyser);
            this._applyTrackState();
            this._bindPeer();
            return true;
        } catch (error) {
            console.warn('Voice chat enable failed:', error);
            return false;
        }
    }

    disable() {
        this.stream?.getTracks().forEach(track => track.stop());
        this.stream = null;
        this.disconnectAll();
        this.audioContext?.close?.();
        this.audioContext = null;
        this.analyser = null;
        this.enabled = false;
    }

    setMuted(muted) { this.userMuted = Boolean(muted); this._applyTrackState(); }
    setPushToTalk(enabled) { this.pushToTalk = Boolean(enabled); this._applyTrackState(); }
    pttDown() { this.pttActive = true; this._applyTrackState(); }
    pttUp() { this.pttActive = false; this._applyTrackState(); }

    _applyTrackState() {
        const live = !this.userMuted && (!this.pushToTalk || this.pttActive);
        this.stream?.getAudioTracks().forEach(track => { track.enabled = live; });
    }

    _bindPeer() {
        const peer = this.network?.peer;
        if (!peer || peer === this._boundPeer) return;
        this._boundPeer = peer;
        peer.on('call', call => this._acceptCall(call));
    }

    syncTargets(targets = []) {
        this._bindPeer();
        this._targets = new Map(targets
            .filter(target => typeof target?.peerId === 'string' && target.peerId)
            .map(target => [target.peerId, target]));
        for (const peerId of [...this.peers.keys()]) {
            if (!this._targets.has(peerId)) this.disconnectPeer(peerId);
        }
        for (const [peerId, target] of this._targets) this._applyRemoteMix(peerId, target);
        if (!this.enabled || !this.stream) return;
        const localPeerId = this.network?.peer?.id;
        for (const peerId of this._targets.keys()) {
            if (shouldInitiateVoice(localPeerId, peerId)) this.connectToPeer(peerId);
        }
    }

    connectToPeer(peerId) {
        if (!this.enabled || !this.stream || this.peers.has(peerId)) return;
        const call = this.network?.peer?.call?.(peerId, this.stream);
        if (call) this._trackCall(peerId, call);
    }

    _acceptCall(call) {
        if (!this.enabled || !this.stream || !this._targets.has(call.peer) || this.peers.has(call.peer)) {
            call.close?.();
            return;
        }
        call.answer(this.stream);
        this._trackCall(call.peer, call);
    }

    _trackCall(peerId, call) {
        this.peers.set(peerId, call);
        call.on('stream', stream => this._attachRemoteAudio(peerId, stream));
        call.on('close', () => this._clearPeer(peerId, call));
        call.on('error', () => this._clearPeer(peerId, call));
    }

    _attachRemoteAudio(peerId, stream) {
        const audio = new Audio();
        audio.autoplay = true;
        audio.srcObject = stream;
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        let mixer = null;
        if (AudioContext) {
            const context = new AudioContext();
            const source = context.createMediaElementSource(audio);
            const gain = context.createGain();
            const panner = context.createStereoPanner?.() || null;
            source.connect(gain);
            if (panner) {
                gain.connect(panner);
                panner.connect(context.destination);
            } else {
                gain.connect(context.destination);
            }
            mixer = { context, gain, panner };
            this.remoteMixers.set(peerId, mixer);
            context.resume?.().catch(() => {});
        }
        this.remoteAudio.set(peerId, audio);
        this._applyRemoteMix(peerId, this._targets.get(peerId));
        audio.play?.().catch(() => {});
        this._monitorSpeaking(peerId, stream);
    }

    _applyRemoteMix(peerId, target = {}) {
        const mix = calculateVoiceSpatialMix(target?.distance, target?.pan, target);
        const mixer = this.remoteMixers.get(peerId);
        const audio = this.remoteAudio.get(peerId);
        if (mixer) {
            mixer.gain.gain.value = mix.gain;
            if (mixer.panner) mixer.panner.pan.value = mix.pan;
            if (audio) audio.muted = false;
        } else if (audio) {
            audio.muted = Boolean(target?.muted);
            audio.volume = mix.gain;
        }
    }

    setRemoteMuted(peerId, muted) {
        const target = this._targets.get(peerId);
        if (target) target.muted = Boolean(muted);
        this._applyRemoteMix(peerId, target);
    }

    _monitorSpeaking(peerId, stream) {
        const context = new (window.AudioContext || window.webkitAudioContext)();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const check = () => {
            if (!this.peers.has(peerId)) { context.close?.(); return; }
            analyser.getByteFrequencyData(data);
            const volume = data.reduce((sum, value) => sum + value, 0) / data.length;
            const speaking = volume > 20;
            if (speaking !== this._speakingState.get(peerId)) {
                this._speakingState.set(peerId, speaking);
                this.onSpeaking?.(peerId, speaking);
            }
            requestAnimationFrame(check);
        };
        check();
    }

    getMyVolume() {
        if (!this.analyser) return 0;
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(data);
        return data.reduce((sum, value) => sum + value, 0) / data.length;
    }

    _clearPeer(peerId, call) {
        if (this.peers.get(peerId) !== call) return;
        this.peers.delete(peerId);
        this.remoteAudio.get(peerId)?.pause?.();
        this.remoteAudio.delete(peerId);
        const mixer = this.remoteMixers.get(peerId);
        mixer?.context?.close?.();
        this.remoteMixers.delete(peerId);
        this._speakingState.delete(peerId);
    }

    disconnectPeer(peerId) {
        const call = this.peers.get(peerId);
        call?.close?.();
        if (call) this._clearPeer(peerId, call);
    }

    disconnectAll() {
        for (const peerId of [...this.peers.keys()]) this.disconnectPeer(peerId);
        this._speakingState.clear();
    }
}
