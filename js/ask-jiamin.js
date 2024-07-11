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
    document.body.style.backgroundSize = 'cover'; // Ensure the background fits the screen; use 'contain' to fit
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.style.backgroundPosition = 'center center';
    document.body.style.backgroundAttachment = 'fixed';

    const clickMeButton = document.getElementById('clickMeButton');
    clickMeButton.addEventListener('click', () => {
        currentGifIndex = (currentGifIndex + 1) % gifs.length;
        document.body.style.backgroundImage = `url(${gifs[currentGifIndex]})`;
    });

    // Yes/No Buttons Functionality
    let bobaCount = 0;

    const yesButton = document.getElementById('yesButton');
    const noButton = document.getElementById('noButton');

    yesButton.addEventListener('click', () => {
        alert('You clicked Yes!');
    });

    noButton.addEventListener('click', () => {
        // Increment the boba count
        bobaCount++;
        // Update the text of the Boba Count button
        bobaCountButton.textContent = `Boba/Coffee Count ヾ( ･\`⌓´･)ﾉﾞ: ${bobaCount}`;
    });

    // Boba Count Rain Animation
    const bobaCountButton = document.getElementById('bobaCountButton');

    bobaCountButton.addEventListener('click', () => {
        // Create a new image element
        const rainImage = document.createElement('img');
        rainImage.src = '../anya.jpg'; // Replace with your rain image path
        rainImage.classList.add('rain-image');

        // Append the image to the body
        document.body.appendChild(rainImage);

        // Remove the image after the animation ends
        setTimeout(() => {
            rainImage.remove();
        }, 5000); // Adjust timing to match your animation duration
    });

});
