(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports"], factory);
    }
})(function (require, exports) {
    "use strict";
    var correctionToolClass = (function () {
        function correctionToolClass() {
            this.syntaxFlag = true;
        }
        correctionToolClass.prototype.registerObject = function (obj) {
            this.callbacks.push(obj);
            for (var tag in obj.downloadTags) {
                this.overpassQuery(obj.downloadTags[tag]);
            }
        };
        ;
        correctionToolClass.prototype.overpassQuery = function (option) {
            var bounds = map.getBounds().getSouth() + ',' + map.getBounds().getWest() + ',' + map.getBounds().getNorth() + ',' + map.getBounds().getEast();
            $.getJSON("https://overpass-api.de/api/interpreter", { "data": '[out:json][timeout:25];(node["' + option + '"](' + bounds + ');way["' + option + '"](' + bounds + ');relation["' + option + '"](' + bounds + '););out body;>;out skel qt;' }, this.correctData);
        };
        ;
        correctionToolClass.prototype.correctData = function (data) {
            for (var i = 0; i < data.elements.length; i++) {
                if (data.elements[i].type === "node") {
                    if (typeof this.nodes[data.elements[i].id] !== "undefined") {
                        continue;
                    }
                    this.nodes[data.elements[i].id] = data.elements[i];
                }
                else if (data.elements[i].type === "way") {
                    if (typeof this.ways[data.elements[i].id] !== "undefined") {
                        continue;
                    }
                    this.ways[data.elements[i].id] = data.elements[i];
                }
                else if (data.elements[i].type === "relation") {
                    if (typeof this.relations[data.elements[i].id] !== "undefined") {
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
            map.removeLayer(this.shownElement);
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
            map.addLayer(this.shownElement);
            map.fitBounds(this.shownElementBounds);
        };
        ;
        correctionToolClass.prototype.syntaxCorrection = function () {
            var input = $('input#input').val();
            if (input !== this.syntaxError.element.tags[this.syntaxError.tag]) {
                this.syntaxError.element.tags[this.syntaxError.tag] = input;
                if (this.modifiedElements.indexOf(this.syntaxError.element) != -1) {
                    this.modifiedElements.splice(this.modifiedElements.indexOf(this.syntaxError.element), 1);
                }
                this.modifiedElements.push(this.syntaxError.element);
            }
            if (this.syntaxErrors.length > 0) {
                this.syntaxEditor();
            }
            else {
                $('#syntax').html("");
                document.getElementById("stateTwo").classList.add("hidden");
                document.getElementById("stateThree").classList.remove("hidden");
            }
        };
        correctionToolClass.prototype.saveNode = function (element) {
            var node = document.createElement('node');
            var id = document.createAttribute('id');
            id.value = element.id;
            node.setAttributeNode(id);
            var changeset = document.createAttribute('changeset');
            changeset.value = this.changesetID;
            node.setAttributeNode(changeset);
            var version = document.createAttribute('version');
            version.value = String(element.version + 1);
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
            id.value = element.id;
            way.setAttributeNode(id);
            var changeset = document.createAttribute('changeset');
            changeset.value = this.changesetID;
            way.setAttributeNode(changeset);
            var version = document.createAttribute('version');
            version.value = String(element.version + 1);
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
                ref.value = element.nodes[key];
                nd.setAttributeNode(ref);
                way.appendChild(nd);
            }
            return way;
        };
        ;
        correctionToolClass.prototype.saveRelation = function (element) {
            var relation = document.createElement('relation');
            var id = document.createAttribute('id');
            id.value = element.id;
            relation.setAttributeNode(id);
            var changeset = document.createAttribute('changeset');
            changeset.value = this.changesetID;
            relation.setAttributeNode(changeset);
            var version = document.createAttribute('version');
            version.value = String(element.version + 1);
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
                ref.value = element.members[key].ref;
                member.setAttributeNode(ref);
                relation.appendChild(member);
            }
            return relation;
        };
        ;
        correctionToolClass.prototype.openChangeset = function () {
            auth.xhr({
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
            }, this.modifyChangeset);
        };
        ;
        correctionToolClass.prototype.modifyChangeset = function (err, data) {
            console.log(err);
            console.log(data);
            if ((!err) && data.length > 0) {
                this.changesetID = data;
            }
            var osmChange = document.createElement('osmChange');
            var version = document.createAttribute('version');
            version.value = '0.6';
            osmChange.setAttributeNode(version);
            var generator = document.createAttribute('generator');
            generator.value = 'osmCorrectionTool';
            osmChange.setAttributeNode(generator);
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
            osmChange.appendChild(modify);
            auth.xhr({
                method: 'POST',
                path: '/api/0.6/changeset/' + this.changesetID + '/upload',
                options: { header: { "Content-Type": "text/xml" } },
                content: '<?xml version="1.0" encoding="UTF-8"?>' +
                    osmChange.outerHTML
            }, this.closeChangeset);
        };
        correctionToolClass.prototype.closeChangeset = function () {
            auth.xhr({
                method: 'PUT',
                path: '/api/0.6/changeset/' + this.changesetID + '/close'
            });
        };
        correctionToolClass.prototype.save = function () {
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
//# sourceMappingURL=correctionTool.js.map