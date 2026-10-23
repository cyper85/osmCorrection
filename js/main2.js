var __extends = (this && this.__extends) || (function () {
    var extendStatics = function (d, b) {
        extendStatics = Object.setPrototypeOf ||
            ({ __proto__: [] } instanceof Array && function (d, b) { d.__proto__ = b; }) ||
            function (d, b) { for (var p in b) if (Object.prototype.hasOwnProperty.call(b, p)) d[p] = b[p]; };
        return extendStatics(d, b);
    };
    return function (d, b) {
        if (typeof b !== "function" && b !== null)
            throw new TypeError("Class extends value " + String(b) + " is not a constructor or null");
        extendStatics(d, b);
        function __() { this.constructor = d; }
        d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
    };
})();
define("correctionTool", ["require", "exports", "leaflet"], function (require, exports, L) {
    "use strict";
    exports.__esModule = true;
    exports.correctionToolClass = void 0;
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
define("correctionObject", ["require", "exports", "libs/osmValidation/osmValidation.js"], function (require, exports, ov) {
    "use strict";
    exports.__esModule = true;
    exports.correctionObjectClass = void 0;
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
    exports.correctTelephone = void 0;
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
define("main2", ["require", "exports", "correctionTool", "tel", "leaflet"], function (require, exports, correctionTool_1, tel_1, L) {
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
