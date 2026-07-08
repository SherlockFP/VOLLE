// voice.js — WebRTC voice chat for party play. Push-to-talk.
// ponytail: getUserMedia + RTCPeerConnection, mesh P2P. Basit, backend yok.
// ponytail: global lock — tek oda, per-account lock gerekirse WebRTC mesh'i genişlet.

export class VoiceChat {
    constructor(network) {
        this.network = network;
        this.stream = null;
        this.peers = new Map(); // peerId → RTCPeerConnection
        this.enabled = false;
        this.muted = false;
        this.pushToTalk = false;
        this.pttActive = false;
        this.audioContext = null;
        this.analyser = null;
        this.onSpeaking = null; // callback(peerId, speaking)
        this._speakingState = new Map();
    }

    // Mikrofonu aç. Kullanıcı izni ister.
    async enable() {
        try {
            this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            this.enabled = true;
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.audioContext.createMediaStreamSource(this.stream);
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            source.connect(this.analyser);
            return true;
        } catch (e) {
            console.warn('Voice chat enable failed:', e);
            return false;
        }
    }

    disable() {
        this.stream?.getTracks().forEach(t => t.stop());
        this.stream = null;
        this.peers.forEach(pc => pc.close());
        this.peers.clear();
        this.enabled = false;
    }

    setMuted(m) { this.muted = m; this.stream?.getAudioTracks().forEach(t => t.enabled = !m); }
    setPushToTalk(on) { this.pushToTalk = on; this.muted = on; this.stream?.getAudioTracks().forEach(t => t.enabled = !on); }
    pttDown() { if (this.pushToTalk) { this.pttActive = true; this.stream?.getAudioTracks().forEach(t => t.enabled = true); } }
    pttUp() { if (this.pushToTalk) { this.pttActive = false; this.stream?.getAudioTracks().forEach(t => t.enabled = false); } }

    // Belirli bir peer'a voice connection kur (PeerJS connection üzerinden).
    async connectToPeer(peerId, dataConn) {
        if (!this.enabled || !this.stream || this.peers.has(peerId)) return;
        // ponytail: PeerJS'in DataConnection'ı üzerinden WebRTC voice kurmak
        // karmaşık — basit yaklaşım: dataConn.peer ile yeni RTCPeerConnection
        try {
            const pc = new RTCPeerConnection();
            this.stream.getTracks().forEach(t => pc.addTrack(t, this.stream));
            pc.ontrack = (e) => {
                const audio = new Audio();
                audio.srcObject = e.streams[0];
                audio.play();
                this._monitorSpeaking(peerId, e.streams[0]);
            };
            this.peers.set(peerId, pc);
        } catch (e) {
            console.warn('Voice peer connect failed:', e);
        }
    }

    // Konuşma tespiti — analyser ile volume ölç.
    _monitorSpeaking(peerId, stream) {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        src.connect(an);
        const data = new Uint8Array(an.frequencyBinCount);
        const check = () => {
            if (!this.peers.has(peerId)) return;
            an.getByteFrequencyData(data);
            const vol = data.reduce((a, b) => a + b, 0) / data.length;
            const speaking = vol > 20;
            if (speaking !== this._speakingState.get(peerId)) {
                this._speakingState.set(peerId, speaking);
                this.onSpeaking?.(peerId, speaking);
            }
            requestAnimationFrame(check);
        };
        check();
    }

    // Kendi konuşma seviyeni ölç (UI için).
    getMyVolume() {
        if (!this.analyser) return 0;
        const data = new Uint8Array(this.analyser.frequencyBinCount);
        this.analyser.getByteFrequencyData(data);
        return data.reduce((a, b) => a + b, 0) / data.length;
    }

    disconnectPeer(peerId) {
        const pc = this.peers.get(peerId);
        if (pc) { pc.close(); this.peers.delete(peerId); this._speakingState.delete(peerId); }
    }

    disconnectAll() {
        this.peers.forEach(pc => pc.close());
        this.peers.clear();
        this._speakingState.clear();
    }
}
