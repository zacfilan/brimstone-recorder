
document.addEventListener("DOMContentLoaded", function (event) {
    // grab the parent window id from the query parameter
    const urlParams = new URLSearchParams(window.location.search);
    const data = JSON.parse(urlParams.get('c'));

    var ctx = document.getElementById('myChart');
    var myChart = new Chart(ctx, data);
});

