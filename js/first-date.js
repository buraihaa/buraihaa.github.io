document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (event) => {
            event.preventDefault();
            const target = event.target.getAttribute('href');
            window.location.href = target;
        });
    });
});
