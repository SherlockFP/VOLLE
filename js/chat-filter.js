// Chat filter (EN + TR slurs and profanity). Runs on the reader's side for every
// chat surface; Settings -> "Chat filter" turns it off (default on). Masks each
// hit with asterisks of the same length so the conversation keeps its shape.
//
// Matching is per word, so "şikayet", "classic", "assassin" or "cockpit" stay
// clean. Each pattern letter may repeat ("fuuuck"), common leetspeak is read as
// letters ("n1gg3r", "f@ck"), and a run of single spaced-out letters is joined
// first ("n i g g e r", "f.u.c.k"). Turkish letters are not folded to Latin, so
// "göt" is caught while English "got" is not.

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i' };
const WORD_CHAR = /[\p{L}0-9@$!]/u;

// Whole word only (with the listed suffix-less forms).
const EXACT = [
    // EN
    'fag', 'fags', 'dick', 'dicks', 'cock', 'cocks', 'pussy', 'coon', 'coons', 'spic', 'spics', 'chink', 'chinks',
    'bastard', 'bastards', 'twat', 'wank', 'wanker', 'kys',
    // TR
    'amk', 'aq', 'mk', 'amq', 'sik', 'sikim', 'sikik', 'sikiş', 'sikis', 'göt', 'götü', 'götün', 'götveren', 'piç', 'piçler', 'oç', 'oçlar',
    'yarak'
];
// Word start, any ending (slurs and stems that are never part of a clean word).
const STEMS = [
    // EN
    'nigger', 'nigga', 'niggah', 'faggot', 'fagot', 'retard', 'motherfuck', 'fuck', 'shit', 'bitch', 'cunt',
    'asshole', 'whore', 'slut', 'kike', 'tranny', 'wetback', 'dickhead',
    // TR
    'orospu', 'orspu', 'yarrak', 'dalyarak', 'amcık', 'amcik', 'amına', 'amina', 'ibne', 'pezevenk',
    'kahpe', 'gavat', 'yavşak', 'yavsak', 'şerefsiz', 'serefsiz', 'sürtük', 'surtuk', 'kaltak', 'siktir', 'sikerim',
    'sikeyim', 'sikiyim', 'sikicem', 'sokuk', 'godoş', 'godos'
];

function letterRun(word) {
    // Each pattern letter may repeat; 'nigger' still needs two g's (so "Niger" is clean).
    let source = '';
    for (const ch of word) source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '+';
    return source;
}
const EXACT_RE = new RegExp(`^(?:${EXACT.map(letterRun).join('|')})$`, 'u');
const STEM_RE = new RegExp(`^(?:${STEMS.map(letterRun).join('|')})`, 'u');

function normalizeWord(word) {
    let out = '';
    for (const ch of word.toLocaleLowerCase('tr')) out += LEET[ch] || (ch === 'ı' ? 'i' : ch);
    return out;
}

export function isBlockedWord(word) {
    const normal = normalizeWord(word);
    if (!normal) return false;
    return EXACT_RE.test(normal) || STEM_RE.test(normal);
}

function mask(text, start, end) {
    let out = '';
    for (let i = start; i < end; i++) out += WORD_CHAR.test(text[i]) ? '*' : text[i];
    return out;
}

export function filterChatText(text, { enabled = true } = {}) {
    const input = String(text ?? '');
    if (!enabled || !input) return input;
    // Tokenise into words with their offsets.
    const words = [];
    let i = 0;
    while (i < input.length) {
        if (!WORD_CHAR.test(input[i])) { i++; continue; }
        let j = i;
        while (j < input.length && WORD_CHAR.test(input[j])) j++;
        words.push({ start: i, end: j, text: input.slice(i, j) });
        i = j;
    }
    const hits = [];
    for (const word of words) if (isBlockedWord(word.text)) hits.push([word.start, word.end]);
    // Spaced-out spelling: 3+ single-letter words in a row, joined.
    for (let a = 0; a < words.length;) {
        if (words[a].text.length !== 1) { a++; continue; }
        let b = a;
        while (b + 1 < words.length && words[b + 1].text.length === 1 && words[b + 1].start - words[b].end <= 3) b++;
        if (b - a >= 2 && isBlockedWord(words.slice(a, b + 1).map(w => w.text).join(''))) hits.push([words[a].start, words[b].end]);
        a = b + 1;
    }
    if (!hits.length) return input;
    hits.sort((x, y) => x[0] - y[0]);
    let out = '';
    let cursor = 0;
    for (const [start, end] of hits) {
        if (start < cursor) continue;
        out += input.slice(cursor, start) + mask(input, start, end);
        cursor = end;
    }
    return out + input.slice(cursor);
}
