export default (seedPhrase) => {
    if (seedPhrase.trim().split(/\s+/g).length < 12) {
        throw new Error('Provided seed phrase must be at least 12 words long');
    }

    return true;
};
