document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            const target = event.target.getAttribute('href');
            window.location.href = target;
        });
    });

    const muteButton = document.getElementById('mute-btn');
    const iframe = document.getElementById('audio-frame');

    // Function to send a message to the iframe to toggle mute
    function sendMessageToIframe(message) {
        if (iframe.contentWindow) {
            iframe.contentWindow.postMessage(message, '*');
        }
    }

    // Toggle mute state
    muteButton.addEventListener('click', () => {
        const isMuted = muteButton.textContent === 'Unmute';
        if (isMuted) {
            muteButton.textContent = 'Mute';
            sendMessageToIframe({ action: 'mute', value: false });
        } else {
            muteButton.textContent = 'Unmute';
            sendMessageToIframe({ action: 'mute', value: true });
        }
    });
});
