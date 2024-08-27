function updateStatus(user) {
    const newStatus = document.getElementById(`new-status-${user}`).value;
    const statusContent = document.getElementById(`status-${user}`).querySelector('.status-content');
    const statusTime = document.getElementById(`status-meta-${user}`).querySelector('.status-time');
    
    if (newStatus) {
        statusContent.textContent = newStatus;
        const now = new Date();
        statusTime.textContent = `${now.toLocaleDateString()} ${now.toLocaleTimeString()} ${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
        document.getElementById(`new-status-${user}`).value = '';
    }
}
