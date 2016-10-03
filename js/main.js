/* 
 * The MIT License
 *
 * Copyright 2016 Andreas.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */


var auth = osmAuth({
    oauth_consumer_key: 'hvBxA6pLC16IPwWZHSZjimbxSFh5Y5LKFMCENcgq',
    oauth_secret: 'PULRxpiJ8xhLNZgqxkHaFqLtFk3O1bzfXAxETOiq',
    auto: true,
    landing: 'land.html'
});

var map;

document.getElementById('test').onclick = function() {
    auth.authenticate(function() {
        update();
    });
};
document.getElementById('test').onclick = function() {
    auth.authenticate(function() {
        update();
    });
};

var downloadOptions = [];
var options = document.getElementsByClassName("option");
for(var i=0; i < options.length; i++) {
    options[i].onclick = function(){
        if(this.classList.contains('inactiv')) {
            downloadOptions.push(this.id.replace("option-",""));
        }
        else {
            downloadOptions.splice(downloadOptions.indexOf(this.id.replace("option-","")),1);
        }
        if(downloadOptions.length === 0) {
            document.getElementById("download").classList.add("hidden");
        }
        else {
            document.getElementById("download").classList.remove("hidden");
        }
        console.log(downloadOptions);
        this.classList.toggle('inactiv');
    };
}

function loadJS (name) {
    var jsTag = document.createElement('script');
    jsTag.type = "text/javascript";
    jsTag.src = 'js/'+name+'.js';
 
    // add dom node to head
    document.getElementsByTagName('head')[0].appendChild(jsTag);
}

document.getElementById("download").onclick = function() {
    document.getElementById("stateOne").classList.add("hidden");
    // Abzufragende Daten sammeln
    for( key in downloadOptions) {
        loadJS(downloadOptions[key]);
    }
    // Abfrage absenden
    // Validator anschmeissen
    // Fehler anzeigen
    document.getElementById("stateTwo").classList.remove("hidden");
};

function update() {
    if (auth.authenticated()) {
        document.getElementById('test').className = 'green';
    } else {
        document.getElementById('test').className = '';
    }
}

(function(){
    if (auth.authenticated()) {
        document.getElementById('test').classList.add("green");
    }
    map = L.map('map', {
        center: [50.6841,10.9171],
        zoom: 15,
        minZoom: 14,
        layers: [
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors'})
        ]
    });
    
})();