// persistent-audio.js
document.addEventListener('DOMContentLoaded', () => {
    const audio = document.getElementById('background-audio');
    
    // Restore playback state from localStorage
    if (localStorage.getItem('audioPaused') === 'true') {
        audio.pause();
    } else {
        audio.play();
    }

    // Update localStorage when the page is unloaded
    window.addEventListener('beforeunload', () => {
        localStorage.setItem('audioPaused', audio.paused);
    });
});
