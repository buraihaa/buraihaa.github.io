document.addEventListener('DOMContentLoaded', function () {
    window.addEventListener('scroll', function () {
        let currentSection = '';
        const sections = document.querySelectorAll('.section');

        sections.forEach(function (section) {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.clientHeight;
            if (scrollY >= sectionTop - sectionHeight / 3) {
                currentSection = section.getAttribute('id');
            }
        });

        // Optional: Highlight active section in navigation
        // Remove this part if not needed
        const navLinks = document.querySelectorAll('nav a');
        navLinks.forEach(function (link) {
            link.classList.remove('active');
            if (link.getAttribute('href').substring(1) === currentSection) {
                link.classList.add('active');
            }
        });
    });
});
