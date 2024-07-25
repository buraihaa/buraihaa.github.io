document.addEventListener('DOMContentLoaded', function() {
    // Get the go home button
    const goHomeButton = document.getElementById('askButton');

    // Add event listener to the go home button
    goHomeButton.addEventListener('click', function() {
        // Redirect to handler.html
        window.location.href = 'ask.html';
    });

    // Get the plans button
    const plansButton = document.getElementById('plansButton');

    // Add event listener to the plans button
    plansButton.addEventListener('click', function() {
        // Redirect to plans.html
        window.location.href = 'plans.html';
    });
});
