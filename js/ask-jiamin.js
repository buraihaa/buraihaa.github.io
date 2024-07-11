document.addEventListener('DOMContentLoaded', () => {
    // GIF Background Change Functionality
    const gifs = [
        '../gifs/0.webp',
        '../gifs/1.webp',
        '../gifs/2.webp', // Add more paths as needed
        '../gifs/3.webp',
        '../gifs/4.gif',
        '../gifs/5.gif',
        '../gifs/6.webp',
        '../gifs/7.gif',
        '../gifs/8.gif',
        '../gifs/9.gif',
        '../gifs/10.jpg'
    ];
    let currentGifIndex = 0;

    // Set initial background
    document.body.style.backgroundImage = `url(${gifs[currentGifIndex]})`;
    document.body.style.backgroundSize = 'cover'; // Ensure the background fits the screen
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.style.backgroundPosition = 'center center';
    document.body.style.backgroundAttachment = 'fixed';

    const clickMeButton = document.getElementById('clickMeButton');
    clickMeButton.addEventListener('click', () => {
        currentGifIndex = (currentGifIndex + 1) % gifs.length;
        document.body.style.backgroundImage = `url(${gifs[currentGifIndex]})`;
    });

    // Yes/No Buttons Functionality
    const yesButton = document.getElementById('yesButton');
    const noButton = document.getElementById('noButton');

    yesButton.addEventListener('click', () => {
        alert('You clicked Yes!');
    });

    noButton.addEventListener('click', () => {
        alert('You clicked No!');
    });
});
