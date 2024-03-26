document.addEventListener('DOMContentLoaded', function () {
    let statements = [
        {
            statement: "Hi Jiamin, did you have a good day?",
            yes: "I'm glad to hear that!",
            no: "I'm sorry to hear that :( Have some boba...but not too much!",
            requiredAnswer: "yes"
        },
        {
            statement: "Do you want to play a game with me?",
            yes: "よかったね!",
            no: "私は今悲しいです。 (ノ_<。) 君はにもっとコーヒーが必要だ。",
            requiredAnswer: "yes"
        },
        {
            statement: "Do you know that you're a pretty unique and cool person?",
            yes: "是的! You know a lot of languages, have a sense of humor, and good music taste!",
            no: "错误的选择",
            requiredAnswer: "yes"
        },
        {
            statement: "オーケー。僕は迷惑ですか?",
            yes: "そうか...",
            no: "うそ (｡･･｡)",
            requiredAnswer: "no"
        },
        {
            statement: "You are my NPC so you have to answer my next question, ok?",
            yes: "хорошо",
            no: "What do you mean no? You are NPC...stop self developing! You need more coffee.",
            requiredAnswer: "yes"
        },
        {
            statement: "I think you're really cute and have a very intersting personality and mind! I can tell you're not like many other girls, and I really like that. I want us to get to know each other more! Do you want to go on a date with me? (We can grab some coffee/tea and go somewhere nice and talk!)",
            yes: "Yay! I'm really glad! Talk to your programmer so we can schedule a good day / time!",
            no: "Sorry, You're my NPC. You're not thinking straight. More boba & coffee for you.",
            requiredAnswer: "yes"
        },
        {
            statement: "おめでとう合格! I'm sorry this was the hardest test ever. You can 'X' out to retake if you want!"
        }
    ]

    let currentIndex = 0;
    let modal = document.getElementById('questionModal');
    let questionText = document.getElementById('questionText');
    let yesButton = document.getElementById('yesButton');
    let noButton = document.getElementById('noButton');
    let refreshContainer = document.getElementById('refreshContainer');

    let nextButton = document.getElementById('nextButton');

    let bobaCount = 0;

    function displayStatement(index) {
        let statement = statements[index];
        questionText.textContent = statement.statement;
        modal.classList.add('is-active');
    
        if (index === statements.length - 1) {
            refreshContainer.classList.remove('is-hidden'); // Show the refresh button container
        } else {
            refreshContainer.classList.add('is-hidden'); // Hide the refresh button container
        }
    
        // Always display both Yes and No buttons
        yesButton.classList.remove('is-hidden');
        noButton.classList.remove('is-hidden');
    
        // Hide the Next button at the beginning of each statement
        hideNextButton();
    }   
       
    function handleYesClick() {
        let statement = statements[currentIndex];
        if (statement.requiredAnswer === "yes" || statement.requiredAnswer === undefined) {
            questionText.textContent = statement.yes; // Display the correct "yes" response
            displayNextButton(); // Display the Next button
        } else {
            displayIncorrectAnswerMessage(statement.yes); // Display the statement's incorrect "yes" response
            bobaCount++;
            updateBobaCount();
        }
    }

    function handleNoClick() {
        let statement = statements[currentIndex];
        if (statement.requiredAnswer === "no" || statement.requiredAnswer === undefined) {
            questionText.textContent = statement.no; // Display the correct "no" response
            displayNextButton(); // Display the Next button
        } else {
            displayIncorrectAnswerMessage(statement.no); // Display the statement's incorrect "no" response
            bobaCount++;
            updateBobaCount();
        }
    }

    function handleNextClick() {
        currentIndex++;
    
        if (currentIndex < statements.length) {
            displayStatement(currentIndex);
        } else {
            modal.classList.remove('is-active'); // Hide the modal
            refreshContainer.classList.remove('is-hidden'); // Show the refresh button container
        }
    
        // Show the Yes and No buttons
        yesButton.classList.remove('is-hidden');
        noButton.classList.remove('is-hidden');
    
        // Hide the Next button
        nextButton.classList.add('is-hidden');
    }
    
    function displayIncorrectAnswerMessage(text) {
        // Display the statement's incorrect answer for a longer duration
        questionText.textContent = text;
        setTimeout(function() {
            // After a longer delay, display the original statement
            displayStatement(currentIndex);
        }, 2800); // Adjust the delay as needed (in milliseconds)
    }

    function hideNextButton() {
        nextButton.classList.add('is-hidden');
    }

    function displayNextButton() {
        let nextButton = document.getElementById('nextButton');
        let yesButton = document.getElementById('yesButton');
        let noButton = document.getElementById('noButton');
    
        // Show the Next button
        nextButton.classList.remove('is-hidden');
    
        // Hide the Yes and No buttons
        yesButton.classList.add('is-hidden');
        noButton.classList.add('is-hidden');
    }

    function closeModal() {
        modal.classList.remove('is-active');
        refreshContainer.classList.remove('is-hidden');
    }

    function refreshPage() {
        location.reload();
    }

    // Function to update the displayed boba count
    function updateBobaCount() {
        bobaCounterButton.textContent = "Boba/Coffee Count  ヾ( ･`⌓´･)ﾉﾞ: " + bobaCount;
    }

    // Refresh Background Button
    let gifs = ['0.webp', '1.webp', '2.webp', '3.webp', '4.gif', '5.gif', '6.webp', '7.gif', '8.gif', '9.gif', '10.jpg']; // Array of background names
    let imgIndex = 0;
    let modalBackground = document.querySelector('.modal-background');
    let changeBackgroundButton = document.getElementById('changeBackground');

    function changeBackground() {
        imgIndex = (imgIndex + 1) % gifs.length; // Cycle through the array
        let gifUrl = 'gifs/' + gifs[imgIndex]; // Change 'path/to/gifs/' to the actual path
        modalBackground.style.backgroundImage = 'url(' + gifUrl + ')';
        refreshContainer.style.backgroundImage = 'url(' + gifUrl + ')';
    }

    // Event Listeners
    yesButton.addEventListener('click', handleYesClick);
    noButton.addEventListener('click', handleNoClick);
    modal.querySelector('.delete').addEventListener('click', closeModal);
    document.getElementById('refreshButton').addEventListener('click', refreshPage);
    changeBackgroundButton.addEventListener('click', changeBackground);
    nextButton.addEventListener('click', handleNextClick);

    // Start with the first question
    displayStatement(currentIndex);
});