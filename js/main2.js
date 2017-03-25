var __extends = (this && this.__extends) || (function () {
    var extendStatics = Object.setPrototypeOf ||
        ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
        function (d, b) { for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p]; };
    return function (d, b) {
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
define("correctionTool", ["require", "exports"], function (require, exports) {
    "use strict";
    exports.__esModule = true;
    var correctionToolClass = (function () {
        function correctionToolClass(auth, map) {
            this.callbacks = [];
            this.auth = auth;
            this.map = map;
            this.nodes = {};
            this.ways = {};
            this.relations = {};
            this.syntaxErrors = [];
            this.syntaxFlag = true;
            this.modifiedElements = [];
            this.shownElementBounds = null;
            this.shownElement = L.featureGroup();
        }
        correctionToolClass.prototype.registerObject = function (obj) {
            this.callbacks.push(obj);
            for (var tag in obj.downloadTags) {
                this.overpassQuery(obj.downloadTags[tag]);
            }
        };
        ;
        correctionToolClass.prototype.overpassQuery = function (option) {
            var self = this;
            var bounds = this.map.getBounds().getSouth() + ',' + this.map.getBounds().getWest() + ',' + this.map.getBounds().getNorth() + ',' + this.map.getBounds().getEast();
            $.getJSON("https://overpass-api.de/api/interpreter", { "data": '[out:json][timeout:25];(node["' + option + '"](' + bounds + ');way["' + option + '"](' + bounds + ');relation["' + option + '"](' + bounds + '););out meta;>;out skel qt;' }, function (data) { self.correctData(data); });
        };
        ;
        correctionToolClass.prototype.correctData = function (data) {
            for (var i = 0; i < data.elements.length; i++) {
                if (data.elements[i].type === "node") {
                    if (typeof this.nodes === "undefined") {
                        this.nodes = {};
                    }
                    else if (typeof this.nodes[data.elements[i].id] !== "undefined") {
                        continue;
                    }
                    this.nodes[data.elements[i].id] = data.elements[i];
                }
                else if (data.elements[i].type === "way") {
                    if (typeof this.ways === "undefined") {
                        this.ways = {};
                    }
                    else if (typeof this.ways[data.elements[i].id] !== "undefined") {
                        continue;
                    }
                    this.ways[data.elements[i].id] = data.elements[i];
                }
                else if (data.elements[i].type === "relation") {
                    if (typeof this.relations === "undefined") {
                        this.relations = {};
                    }
                    else if (typeof this.relations[data.elements[i].id] !== "undefined") {
                        continue;
                    }
                    this.relations[data.elements[i].id] = data.elements[i];
                }
                if (typeof data.elements[i].tags !== "undefined") {
                    var correct = [];
                    for (var key in this.callbacks) {
                        correct = this.callbacks[key].correctingSyntax(data.elements[i]);
                        if (correct.length > 0) {
                            for (var cKey in correct) {
                                this.syntaxErrors.push({
                                    element: data.elements[i],
                                    tag: correct[cKey],
                                    plugin: this.callbacks[key]
                                });
                            }
                        }
                    }
                }
            }
            if (this.syntaxFlag && (this.syntaxErrors.length > 0)) {
                this.syntaxFlag = false;
                this.syntaxEditor();
            }
        };
        correctionToolClass.prototype.syntaxEditor = function () {
            this.syntaxError = this.syntaxErrors.shift();
            this.showElement(this.syntaxError.element);
            this.syntaxError.plugin.syntaxEditor(this.syntaxError.tag, this.syntaxError.element);
        };
        ;
        correctionToolClass.prototype.showNode = function (element) {
            this.shownElement.addLayer(L.circle(L.latLng(element.lat, element.lon), 3));
            if (this.shownElementBounds === null) {
                this.shownElementBounds = new L.LatLngBounds(L.latLng(element.lat, element.lon), L.latLng(element.lat, element.lon));
            }
            else {
                this.shownElementBounds = this.shownElementBounds.extend(L.latLng(element.lat, element.lon));
            }
        };
        ;
        correctionToolClass.prototype.showWay = function (element) {
            var way = [];
            var shownElement;
            for (var i in element.nodes) {
                way.push(L.latLng(this.nodes[element.nodes[i]].lat, this.nodes[element.nodes[i]].lon));
            }
            if (element.nodes[0] === element.nodes[element.nodes.length - 1]) {
                shownElement = L.polygon(way);
            }
            else {
                shownElement = L.polyline(way);
            }
            this.shownElement.addLayer(shownElement);
            if (this.shownElementBounds === null) {
                this.shownElementBounds = shownElement.getBounds();
            }
            else {
                this.shownElementBounds.extend(shownElement.getBounds());
            }
        };
        correctionToolClass.prototype.showRelation = function (element) {
            console.log("bah");
        };
        correctionToolClass.prototype.showElement = function (element) {
            this.shownElementBounds = null;
            this.map.removeLayer(this.shownElement);
            this.shownElement.clearLayers();
            if (element.type === "node") {
                this.showNode(element);
            }
            else if (element.type === "way") {
                this.showWay(element);
            }
            else if (element.type === "relation") {
                this.showRelation(element);
            }
            this.map.addLayer(this.shownElement);
            this.map.fitBounds(this.shownElementBounds);
        };
        ;
        correctionToolClass.prototype.syntaxCorrectionSkip = function () {
            if (this.syntaxErrors.length > 0) {
                this.syntaxEditor();
            }
            else {
                $('#syntax').html("");
                document.getElementById("stateTwo").classList.add("hidden");
                document.getElementById("stateThree").classList.remove("hidden");
            }
        };
        ;
        correctionToolClass.prototype.syntaxCorrection = function () {
            var input = $('input#input').val();
            if (typeof this.modifiedElements === "undefined") {
                this.modifiedElements = [];
            }
            if (input !== this.syntaxError.element.tags[this.syntaxError.tag]) {
                this.syntaxError.element.tags[this.syntaxError.tag] = input;
                if (this.modifiedElements.indexOf(this.syntaxError.element) != -1) {
                    this.modifiedElements.splice(this.modifiedElements.indexOf(this.syntaxError.element), 1);
                }
                this.modifiedElements.push(this.syntaxError.element);
            }
            this.syntaxCorrectionSkip();
        };
        correctionToolClass.prototype.saveNode = function (element) {
            var node = document.createElement('node');
            var id = document.createAttribute('id');
            id.value = String(element.id);
            node.setAttributeNode(id);
            var changeset = document.createAttribute('changeset');
            changeset.value = this.changesetID;
            node.setAttributeNode(changeset);
            var version = document.createAttribute('version');
            console.log(element);
            console.log(element.version + 1);
            console.log(String(element.version + 1));
            version.value = String(element.version);
            node.setAttributeNode(version);
            var lat = document.createAttribute('lat');
            lat.value = String(element.lat);
            node.setAttributeNode(lat);
            var lon = document.createAttribute('lon');
            lon.value = String(element.lon);
            node.setAttributeNode(lon);
            for (var key in element.tags) {
                var tag = document.createElement('tag');
                var k = document.createAttribute('k');
                k.value = key;
                tag.setAttributeNode(k);
                var v = document.createAttribute('v');
                v.value = element.tags[key];
                tag.setAttributeNode(v);
                node.appendChild(tag);
            }
            return node;
        };
        correctionToolClass.prototype.saveWay = function (element) {
            var way = document.createElement('way');
            var id = document.createAttribute('id');
            id.value = String(element.id);
            way.setAttributeNode(id);
            var changeset = document.createAttribute('changeset');
            changeset.value = this.changesetID;
            way.setAttributeNode(changeset);
            var version = document.createAttribute('version');
            version.value = String(element.version);
            way.setAttributeNode(version);
            for (var key in element.tags) {
                var tag = document.createElement('tag');
                var k = document.createAttribute('k');
                k.value = key;
                tag.setAttributeNode(k);
                var v = document.createAttribute('v');
                v.value = element.tags[key];
                tag.setAttributeNode(v);
                way.appendChild(tag);
            }
            for (var key in element.nodes) {
                var nd = document.createElement('nd');
                var ref = document.createAttribute('ref');
                ref.value = String(element.nodes[key]);
                nd.setAttributeNode(ref);
                way.appendChild(nd);
            }
            return way;
        };
        ;
        correctionToolClass.prototype.saveRelation = function (element) {
            var relation = document.createElement('relation');
            var id = document.createAttribute('id');
            id.value = String(element.id);
            relation.setAttributeNode(id);
            var changeset = document.createAttribute('changeset');
            changeset.value = this.changesetID;
            relation.setAttributeNode(changeset);
            var version = document.createAttribute('version');
            version.value = String(element.version);
            relation.setAttributeNode(version);
            for (var key in element.tags) {
                var tag = document.createElement('tag');
                var k = document.createAttribute('k');
                k.value = key;
                tag.setAttributeNode(k);
                var v = document.createAttribute('v');
                v.value = element.tags[key];
                tag.setAttributeNode(v);
                relation.appendChild(tag);
            }
            for (var key in element.members) {
                var member = document.createElement('member');
                var type = document.createAttribute('type');
                type.value = element.members[key].type;
                member.setAttributeNode(type);
                var role = document.createAttribute('role');
                role.value = element.members[key].role;
                member.setAttributeNode(role);
                var ref = document.createAttribute('ref');
                ref.value = String(element.members[key].ref);
                member.setAttributeNode(ref);
                relation.appendChild(member);
            }
            return relation;
        };
        ;
        correctionToolClass.prototype.openChangeset = function () {
            var self = this;
            this.auth.xhr({
                method: 'PUT',
                path: '/api/0.6/changeset/create',
                options: { header: { "Content-Type": "text/xml" } },
                content: '<?xml version="1.0" encoding="UTF-8"?>' +
                    '<osm version="0.6" generator="JOSM">' +
                    '<changeset>' +
                    '<tag k="created_by" v="osmCorrection v0.0.1"/>' +
                    '<tag k="comment" v="Syntax correction and validation"/>' +
                    '</changeset>' +
                    '</osm>'
            }, function (err, data) { self.modifyChangeset(err, data); });
        };
        ;
        correctionToolClass.prototype.modifyChangeset = function (err, data) {
            console.log(err);
            console.log(data);
            if ((!err) && data.length > 0) {
                this.changesetID = data;
            }
            var modify = document.createElement('modify');
            for (var i in this.modifiedElements) {
                if (this.modifiedElements[i].type === "node") {
                    modify.appendChild(this.saveNode(this.modifiedElements[i]));
                }
                else if (this.modifiedElements[i].type === "way") {
                    modify.appendChild(this.saveWay(this.modifiedElements[i]));
                }
                else if (this.modifiedElements[i].type === "relation") {
                    modify.appendChild(this.saveRelation(this.modifiedElements[i]));
                }
            }
            var self = this;
            this.auth.xhr({
                method: 'POST',
                path: '/api/0.6/changeset/' + this.changesetID + '/upload',
                options: { header: { "Content-Type": "text/xml" } },
                content: '<?xml version="1.0" encoding="UTF-8"?>' +
                    '<osmChange version="0.6" generator="osmCorrectionTool">' +
                    modify.outerHTML +
                    '</osmChange>'
            }, function () { self.closeChangeset(); });
        };
        ;
        correctionToolClass.prototype.closeChangeset = function () {
            this.auth.xhr({
                method: 'PUT',
                path: '/api/0.6/changeset/' + this.changesetID + '/close'
            }, function () { });
        };
        ;
        correctionToolClass.prototype.save = function () {
            console.log(this.modifiedElements);
            if (this.modifiedElements.length > 0) {
                this.openChangeset();
            }
            else {
                console.log(this.modifiedElements);
            }
            return false;
        };
        ;
        return correctionToolClass;
    }());
    exports.correctionToolClass = correctionToolClass;
    ;
});
if (typeof osmValidation === "undefined") {
    var osmValidation;
}
(function () {
    osmValidation = new Object();
    osmValidation.PLAIN_FLAG = "";
    osmValidation.msg = osmValidation.PLAIN_FLAG;
    var regexSeparators = /[\x2E\u3002\uFF0E\uFF61]/g;
    var regexNonASCII = /[^\0-\x7E]/;
    var regexPunycode = /^xn--/;
    var maxInt = 2147483647;
    var base = 36;
    var tMin = 1;
    var tMax = 26;
    var skew = 38;
    var damp = 700;
    var initialBias = 72;
    var initialN = 128;
    var delimiter = '-';
    var baseMinusTMin = base - tMin;
    var floor = Math.floor;
    var stringFromCharCode = String.fromCharCode;
    var map = function (array, fn) {
        var result = [];
        var length = array.length;
        while (length--) {
            result[length] = fn(array[length]);
        }
        return result;
    };
    var mapDomain = function (string, fn) {
        var parts = string.split('@');
        var result = '';
        if (parts.length > 1) {
            result = parts[0] + '@';
            string = parts[1];
        }
        string = string.replace(regexSeparators, '\x2E');
        var labels = string.split('.');
        var encoded = map(labels, fn).join('.');
        return result + encoded;
    };
    function ucs2decode(string) {
        var output = [];
        var counter = 0;
        var length = string.length;
        while (counter < length) {
            var value = string.charCodeAt(counter++);
            if (value >= 0xD800 && value <= 0xDBFF && counter < length) {
                var extra = string.charCodeAt(counter++);
                if ((extra & 0xFC00) == 0xDC00) {
                    output.push(((value & 0x3FF) << 10) + (extra & 0x3FF) + 0x10000);
                }
                else {
                    output.push(value);
                    counter--;
                }
            }
            else {
                output.push(value);
            }
        }
        return output;
    }
    var encode = function (input) {
        var output = [];
        input = ucs2decode(input);
        var inputLength = input.length;
        var n = 128;
        var delta = 0;
        var bias = 72;
        for (var _i = 0, input_1 = input; _i < input_1.length; _i++) {
            var currentValue = input_1[_i];
            if (currentValue < 0x80) {
                output.push(stringFromCharCode(currentValue));
            }
        }
        var basicLength = output.length;
        var handledCPCount = basicLength;
        if (basicLength) {
            output.push('-');
        }
        while (handledCPCount < inputLength) {
            var m = maxInt;
            for (var _a = 0, input_2 = input; _a < input_2.length; _a++) {
                var currentValue = input_2[_a];
                if (currentValue >= n && currentValue < m) {
                    m = currentValue;
                }
            }
            var handledCPCountPlusOne = handledCPCount + 1;
            if (m - n > floor((maxInt - delta) / handledCPCountPlusOne)) {
                error('overflow');
            }
            delta += (m - n) * handledCPCountPlusOne;
            n = m;
            for (var _b = 0, input_3 = input; _b < input_3.length; _b++) {
                var currentValue = input_3[_b];
                if (currentValue < n && ++delta > maxInt) {
                    error('overflow');
                }
                if (currentValue == n) {
                    var q = delta;
                    for (var k = base;; k += base) {
                        var t = k <= bias ? tMin : (k >= bias + tMax ? tMax : k - bias);
                        if (q < t) {
                            break;
                        }
                        var qMinusT = q - t;
                        var baseMinusT = base - t;
                        output.push(stringFromCharCode(digitToBasic(t + qMinusT % baseMinusT, 0)));
                        q = floor(qMinusT / baseMinusT);
                    }
                    output.push(stringFromCharCode(digitToBasic(q, 0)));
                    bias = adapt(delta, handledCPCountPlusOne, handledCPCount == basicLength);
                    delta = 0;
                    ++handledCPCount;
                }
            }
            ++delta;
            ++n;
        }
        return output.join('');
    };
    var idn2ascii = function (urlpart) {
        return mapDomain(urlpart, function (string) {
            return regexNonASCII.test(string)
                ? 'xn--' + encode(string)
                : string;
        });
    };
    osmValidation.PHONE_EMERGENCY = "phonenumber is a valid emergency number";
    osmValidation.PHONE_VALID = "phonenumber is a valid international number";
    osmValidation.PHONE_INVALID = "number is not a emergency number or an international phonenumber (\+\d{1,4} \d+( \d+(-\d+)))";
    osmValidation.phone = function (number) {
        switch (number) {
            case "000":
            case "15":
            case "17":
            case "18":
            case "061":
            case "062":
            case "080":
            case "081":
            case "085":
            case "088":
            case "091":
            case "092":
            case "100":
            case "101":
            case "102":
            case "103":
            case "108":
            case "110":
            case "112":
            case "113":
            case "117":
            case "118":
            case "119":
            case "122":
            case "123":
            case "133":
            case "143":
            case "144":
            case "145":
            case "147":
            case "150":
            case "153":
            case "154":
            case "155":
            case "158":
            case "160":
            case "165":
            case "166":
            case "190":
            case "191":
            case "192":
            case "193":
            case "194":
            case "199":
            case "911":
            case "995":
            case "996":
            case "997":
            case "998":
            case "999":
            case "0123":
            case "1006":
            case "1414":
            case "1415":
            case "1515":
            case "1530":
            case "1669":
            case "02800":
                osmValidation.msg = osmValidation.PHONE_EMERGENCY;
                return true;
            default:
                var regex = /^\+(?:[0-9][ -]?){6,14}[0-9]$/;
                if (regex.test(number)) {
                    osmValidation.msg = osmValidation.PHONE_VALID;
                    return true;
                }
                else {
                    osmValidation.msg = osmValidation.PHONE_INVALID;
                    return false;
                }
        }
    };
    osmValidation.MAIL_VALID = "email is valid";
    osmValidation.MAIL_INVALID = "email is invalid";
    osmValidation.mail = function (email) {
        var regex = /^(([^<>()[\]\\.,;:\s@\"]+(\.[^<>()[\]\\.,;:\s@\"]+)*)|(\".+\"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        if (regex.test(email)) {
            osmValidation.msg = osmValidation.MAIL_VALID;
            return true;
        }
        else {
            osmValidation.msg = osmValidation.MAIL_INVALID;
            return false;
        }
    };
    osmValidation.URL_PROTOCOLL_INVALID = "URL has no or wrong protocoll. At this time, I allow only http or https";
    osmValidation.URL_LOCAL_ADDRESS = "URL to a local service is not useful";
    osmValidation.URL_HOST_INVALID = "Host is not a ipv4- or ipv6-address and it has no fqdn";
    osmValidation.URL_INVALID = "URL seems broken";
    osmValidation.URL_VALID = "URL is valid";
    osmValidation.url = function (url) {
        var protocoll = /^https?:\/\//i;
        if (!protocoll.test(url)) {
            osmValidation.msg = osmValidation.URL_PROTOCOLL_INVALID;
            return false;
        }
        else {
            url = url.replace(protocoll, "");
        }
        var userpass = /^((\w|\d)(?:\:(\w|\d)+?)\@)/;
        url = url.replace(userpass, "");
        var host_ipv4 = /^(1?\d{1,2}|2[0-4][0-9]|25[0-5])\.(1?\d{1,2}|2[0-4][0-9]|25[0-5])\.(1?\d{1,2}|2[0-4][0-9]|25[0-5])\.(1?\d{1,2}|2[0-4][0-9]|25[0-5])/;
        var host_ipv6 = /^\[(([0-9A-Fa-f]{1,4}:){1,7}|:)(:|([0-9A-Fa-f]{1,4}:){1,7})[0-9A-Fa-f]{0,4}\]/;
        var host_domain = /^[0-9a-zA-Z-_.~]+\.\w+/;
        if (host_ipv4.test(url)) {
            var local_ipv4 = /^((0?10\.)|(127\.)|(192\.168\.)|(169\.254\.)|(172\.0?((1[6-9])|(2[0-9])|(3[0-1]))\.))/;
            if (local_ipv4.test(url)) {
                osmValidation.msg = osmValidation.URL_LOCAL_ADDRESS;
                return false;
            }
            url = url.replace(host_ipv4, "");
        }
        else if (host_ipv6.test(url)) {
            var local_ipv6 = /^\[(([fF]([cCdD]|[eE]80))|(::\d+\]))/;
            if (local_ipv6.test(url)) {
                osmValidation.msg = osmValidation.URL_LOCAL_ADDRESS;
                return false;
            }
            url = url.replace(host_ipv6, "");
        }
        else if (!host_domain.test(url)) {
            var idn_name_regex = /^.+([?#/].*)$/;
            var idn = idn2ascii(url.replace(idn_name_regex, ""));
            var idn_decoded = idn2ascii(idn);
            if (!host_domain.test(idn_decoded)) {
                osmValidation.msg = osmValidation.URL_HOST_INVALID;
                return false;
            }
            else {
                url = url.replace(/^(.+)(?:[?#/].*?)?$/, "");
            }
        }
        else {
            url = url.replace(host_domain, "");
        }
        var port = /^\:\d+/;
        url = url.replace(port, "");
        if (url.length === 0) {
            osmValidation.msg = osmValidation.URL_VALID;
            return true;
        }
        var delimiter = /^([?#/].*)?$/;
        if (delimiter.test(url)) {
            osmValidation.msg = osmValidation.URL_VALID;
            return true;
        }
        else {
            osmValidation.msg = osmValidation.URL_INVALID;
            return false;
        }
    };
    osmValidation.FACEBOOK_ID_ONLY = "correct facebook ID";
    osmValidation.FACEBOOK_URL_VALID = "correct facebook-page URL";
    osmValidation.FACEBOOK_URL_INVALID = "Neither a valid facebook ID nor a plain link (without parameter) to a page";
    osmValidation.facebook = function (facebookID) {
        var facebookChars = /^[a-z0-9.]{5,}$/i;
        if (facebookChars.test(facebookID)) {
            osmValidation.msg = osmValidation.FACEBOOK_ID_ONLY;
            return true;
        }
        var facebookURL = /^(?:https?:\/\/?)?(?:www\.?)?(?:facebook|fb?)\.com\/(?:(?:[a-z0-9.]{5,}?)|pages\/(?:[^/?#\s]{5,}?)\/(?:[0-9]{5,}?)?)[\/]?$/i;
        if (facebookURL.test(facebookID)) {
            osmValidation.msg = osmValidation.FACEBOOK_URL_VALID;
            return true;
        }
        osmValidation.msg = osmValidation.FACEBOOK_URL_INVALID;
        return false;
    };
    osmValidation.TWITTER_ID_ONLY = "correct twitter ID";
    osmValidation.TWITTER_URL_VALID = "correct twitter-page URL";
    osmValidation.TWITTER_URL_INVALID = "Neither a valid twitter ID nor a plain link (without parameter) to a page";
    osmValidation.twitter = function (twitterID) {
        if (/^[@]?[a-z0-9_]{1,15}$/i.test(twitterID)) {
            osmValidation.msg = osmValidation.TWITTER_ID_ONLY;
            return true;
        }
        else if (/^(?:https?:\/\/)?(?:www\.)?twitter\.(?:(?:com)|(?:de))\/[@]?[a-z0-9_]{1,15}$/i.test(twitterID)) {
            osmValidation.msg = osmValidation.TWITTER_URL_VALID;
            return true;
        }
        else {
            osmValidation.msg = osmValidation.TWITTER_URL_INVALID;
            return false;
        }
    };
    osmValidation.GOOGLE_ID_ONLY = "correct google ID";
    osmValidation.GOOGLE_NAME_ONLY = "correct google plus name";
    osmValidation.GOOGLE_URL_VALID = "correct google-page URL";
    osmValidation.GOOGLE_URL_INVALID = "Neither a valid google ID, name nor a plain link (without parameter) to a page";
    osmValidation.google = function (googleID) {
        if (/^\d{+}21}$/.test(googleID)) {
            osmValidation.msg = osmValidation.GOOGLE_ID_ONLY;
            return true;
        }
        else if (/^(?:\+?)?[a-z][a-z0-9-_]+$/i.test(googleID)) {
            osmValidation.msg = osmValidation.GOOGLE_NAME_ONLY;
            return true;
        }
        else if (/^(?:https?:\/\/)?plus.google.com\/(?:(?:\w\/\d\/)|(?:communities\/))?((\d{21})|((?:\+)?[a-z][a-z0-9-_]+))[/]?$/i.test(googleID)) {
            osmValidation.msg = osmValidation.GOOGLE_URL_VALID;
            return true;
        }
        osmValidation.msg = osmValidation.GOOGLE_URL_INVALID;
        return false;
    };
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = osmValidation;
    }
})();
define("correctionObject", ["require", "exports", "libs/osmValidation/osmValidation"], function (require, exports, ov) {
    "use strict";
    exports.__esModule = true;
    var correctionObjectClass = (function () {
        function correctionObjectClass(correctionTool) {
            this.id = "";
            this.correctionTool = correctionTool;
            this.osmValidation = ov;
        }
        correctionObjectClass.prototype.getTags = function () {
            return this.downloadTags;
        };
        correctionObjectClass.prototype.editorForm = function (label, value, type) {
            if (type === void 0) { type = "error"; }
            var self = this;
            var div = $('<div />')
                .addClass("syntaxElement")
                .addClass("form-group")
                .addClass("panel")
                .addClass("panel-" + type)
                .append($("<label />")
                .attr("for", "input")
                .addClass("control-label")
                .addClass("panel-heading")
                .html(label))
                .append($("<input />")
                .attr("id", "input")
                .addClass("form-control")
                .addClass("panel-body")
                .attr("type", "text")
                .val(value)
                .keyup(function () {
                if (self.syntaxValidator($(this).val())) {
                    $(this).removeClass('invalid');
                    $(this).parent().parent().children("input[type=submit]").prop('disabled', false);
                }
                else {
                    $(this).addClass('invalid');
                    $(this).parent("form").children("input[type=submit]").prop('disabled', true);
                }
            }));
            var form = $('<form />')
                .attr("role", "form")
                .append(div)
                .append($("<input />")
                .attr("type", "submit")
                .addClass("btn")
                .prop('disabled', true)
                .addClass("btn-success")
                .html("weiter")
                .click(function () {
                self.correctionTool.syntaxCorrection();
            }))
                .append($("<button />")
                .addClass("btn")
                .addClass("btn-danger")
                .html("überspringen")
                .click(function () {
                self.correctionTool.syntaxCorrectionSkip();
            }));
            return form;
        };
        correctionObjectClass.prototype.syntaxEditor = function (tag, element) {
            $('#syntax').html("");
            $('#syntax').append(this.editorForm(tag, element.tags[tag]));
            $('#syntax form input').focus();
        };
        return correctionObjectClass;
    }());
    exports.correctionObjectClass = correctionObjectClass;
});
define("osmObjectInterface", ["require", "exports"], function (require, exports) {
    "use strict";
    exports.__esModule = true;
});
define("tel", ["require", "exports", "correctionObject"], function (require, exports, correctionObject_1) {
    "use strict";
    exports.__esModule = true;
    var correctTelephone = (function (_super) {
        __extends(correctTelephone, _super);
        function correctTelephone() {
            var _this = _super !== null && _super.apply(this, arguments) || this;
            _this.id = "tel";
            _this.downloadTags = ["contact:phone", "phone", "contact:fax", "fax"];
            _this.syntaxValidator = _this.osmValidation.phone;
            _this.syntaxValidationHint = "";
            return _this;
        }
        correctTelephone.prototype.correctingSyntax = function (element) {
            var answer = [];
            if (typeof element.tags !== "undefined") {
                var regex = /^\+(?:[0-9][ -]?){6,14}[0-9]$/;
                for (var key in this.downloadTags) {
                    if (typeof element.tags[this.downloadTags[key]] !== "undefined") {
                        if (!this.osmValidation.phone(element.tags[this.downloadTags[key]])) {
                            answer.push(this.downloadTags[key]);
                        }
                    }
                }
            }
            return answer;
        };
        ;
        return correctTelephone;
    }(correctionObject_1.correctionObjectClass));
    exports.correctTelephone = correctTelephone;
});
define("main2", ["require", "exports", "correctionTool", "tel"], function (require, exports, correctionTool_1, tel_1) {
    "use strict";
    exports.__esModule = true;
    var auth = new osmAuth({
        oauth_consumer_key: 'hvBxA6pLC16IPwWZHSZjimbxSFh5Y5LKFMCENcgq',
        oauth_secret: 'PULRxpiJ8xhLNZgqxkHaFqLtFk3O1bzfXAxETOiq',
        auto: true,
        url: 'https://www.openstreetmap.org',
        landing: 'land.html'
    });
    var correctionTool;
    document.getElementById('osmLogin').onclick = function () {
        auth.authenticate(function () {
            update();
        });
    };
    var downloadOptions = [];
    $('.option').click(function () {
        if (this.classList.contains('btn-default')) {
            downloadOptions.push(this.id.replace("option-", ""));
        }
        else {
            downloadOptions.splice(downloadOptions.indexOf(this.id.replace("option-", "")), 1);
        }
        if (downloadOptions.length === 0) {
            document.getElementById("download").classList.add("hidden");
        }
        else {
            document.getElementById("download").classList.remove("hidden");
        }
        this.classList.toggle('btn-default');
        this.classList.toggle('btn-primary');
    });
    $('#download').click(function () {
        document.getElementById("stateOne").classList.add("hidden");
        for (var key in downloadOptions) {
            switch (downloadOptions[key]) {
                case "tel":
                    correctionTool.registerObject(new tel_1.correctTelephone(correctionTool));
                    break;
            }
            ;
        }
        document.getElementById("stateTwo").classList.remove("hidden");
    });
    function update() {
        if (auth.authenticated()) {
            document.getElementById('osmLogin').className = 'green';
            document.getElementById("stateOne").classList.remove("hidden");
            document.getElementById("stateZero").classList.add("hidden");
            document.getElementById("stateTwo").classList.add("hidden");
        }
        else {
            document.getElementById("stateZero").classList.add("hidden");
            document.getElementById("stateOne").classList.remove("hidden");
            document.getElementById('osmLogin').className = '';
        }
    }
    if (auth.authenticated()) {
        document.getElementById("stateZero").classList.add("hidden");
        document.getElementById("stateOne").classList.remove("hidden");
    }
    map = L.map('map', {
        center: [50.6841, 10.9171],
        zoom: 15,
        minZoom: 14,
        layers: [
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: 'Map data &copy; <a href="http://openstreetmap.org">OpenStreetMap</a> contributors' })
        ]
    });
    correctionTool = new correctionTool_1.correctionToolClass(auth, map);
    $("#save").click(function () { correctionTool.save(); return false; });
});
//# sourceMappingURL=main2.js.map