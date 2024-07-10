document.addEventListener('DOMContentLoaded', () => {
    const yesButton = document.getElementById('yesButton');
    const noButton = document.getElementById('noButton');

    yesButton.addEventListener('click', () => {
        alert('You clicked Yes!');
    });

    noButton.addEventListener('click', () => {
        alert('You clicked No!');
    });
});
