/// <reference path="../typings/globals/osmauth/index.d.ts" />
/* 
 * The MIT License
 *
 * Copyright 2017 Andreas Neumann <andr.neumann@googlemail.com>.
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

import {correctionObjectClass} from "./correctionObject";
import {osmObject, overpassObject, syntaxErrorObject} from "./osmObjectInterface";

export class correctionToolClass {
    /**
     * correctionObjects
     * @type Array
     */
    callbacks: correctionObjectClass[];
    auth: OSMAuth.OSMAuthInstance;
    map: L.Map;

    nodes: {[key: number]: osmObject};
    ways: {[key: number]: osmObject};
    relations: {[key: number]: osmObject};
    syntaxErrors: syntaxErrorObject[];
    syntaxFlag: boolean;

    modifiedElements: osmObject[];
    syntaxError: syntaxErrorObject;

    shownElement: L.FeatureGroup;
    shownElementBounds: L.LatLngBounds;

    constructor(auth: OSMAuth.OSMAuthInstance, map: L.Map) {
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
    registerObject(obj: correctionObjectClass): void {
        this.callbacks.push(obj);
        for (var tag in obj.downloadTags) {
            this.overpassQuery(obj.downloadTags[tag]);
        }
    };

    overpassQuery(option: string): void {
        var self = this;
        let bounds = this.map.getBounds().getSouth() + ',' + this.map.getBounds().getWest() + ',' + this.map.getBounds().getNorth() + ',' + this.map.getBounds().getEast();

        $.getJSON("https://overpass-api.de/api/interpreter",
            {"data": '[out:json][timeout:25];(node["' + option + '"](' + bounds + ');way["' + option + '"](' + bounds + ');relation["' + option + '"](' + bounds + '););out meta;>;out skel qt;'},
            function(data) { self.correctData(data)}
        );
    };

    correctData(data: overpassObject): void {
        for (let i = 0; i < data.elements.length; i++) {
            if (data.elements[i].type === "node") {
                if (typeof this.nodes === "undefined") {
                    this.nodes = {};
                } else if(typeof this.nodes[data.elements[i].id] !== "undefined") {
                    continue;
                }
                this.nodes[data.elements[i].id] = data.elements[i];
            } else if (data.elements[i].type === "way") {
                if (typeof this.ways === "undefined") {
                    this.ways = {};
                } else if(typeof this.ways[data.elements[i].id] !== "undefined") {
                    continue;
                }
                this.ways[data.elements[i].id] = data.elements[i];
            } else if (data.elements[i].type === "relation") {
                if (typeof this.relations === "undefined") {
                    this.relations = {}
                } else if (typeof this.relations[data.elements[i].id] !== "undefined") {
                    continue;
                }
                this.relations[data.elements[i].id] = data.elements[i];
            }
            if (typeof data.elements[i].tags !== "undefined") {
                let correct: string[] = [];
                for (let key in this.callbacks) {
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
    }

    syntaxEditor(): void {
        this.syntaxError = this.syntaxErrors.shift();
        this.showElement(this.syntaxError.element);
        this.syntaxError.plugin.syntaxEditor(this.syntaxError.tag, this.syntaxError.element);
    };

    showNode(element: osmObject): void {
        this.shownElement.addLayer(L.circle(L.latLng(element.lat, element.lon), 3));
        if (this.shownElementBounds === null) {
            this.shownElementBounds = new L.LatLngBounds(L.latLng(element.lat, element.lon), L.latLng(element.lat, element.lon));
        } else {
            this.shownElementBounds = this.shownElementBounds.extend(L.latLng(element.lat, element.lon));
        }
    };

    showWay(element: osmObject): void {
        let way = [];
        let shownElement;
        for (let i in element.nodes) {
            way.push(L.latLng(this.nodes[element.nodes[i]].lat, this.nodes[element.nodes[i]].lon));
        }
        if (element.nodes[0] === element.nodes[element.nodes.length - 1]) {
            shownElement = L.polygon(way);
        } else {
            shownElement = L.polyline(way);
        }

        this.shownElement.addLayer(shownElement);

        if (this.shownElementBounds === null) {
            this.shownElementBounds = shownElement.getBounds();
        } else {
            this.shownElementBounds.extend(shownElement.getBounds());
        }
    }

    showRelation(element: osmObject): void {
        console.log("bah");
    }

    showElement(element: osmObject): void {
        this.shownElementBounds = null;
        this.map.removeLayer(this.shownElement);
        this.shownElement.clearLayers();

        if (element.type === "node") {
            this.showNode(element);
        } else if (element.type === "way") {
            this.showWay(element);
        } else if (element.type === "relation") {
            this.showRelation(element);
        }
        this.map.addLayer(this.shownElement);

        this.map.fitBounds(this.shownElementBounds);
    };

    syntaxCorrectionSkip():void {
        // irgendwas speichern
        if (this.syntaxErrors.length > 0) {
            this.syntaxEditor();
        } else {
            $('#syntax').html("");
            document.getElementById("stateTwo").classList.add("hidden");
            document.getElementById("stateThree").classList.remove("hidden");
        }
    };
    
    syntaxCorrection(): void {

        var input = $('input#input').val();
        if ( typeof this.modifiedElements === "undefined" ) {
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
    }

    /**
     * Erzeugt XML-Modifycode für Node
     * @param {OSMElement} element
     * @param int changesetID
     * @returns {Element|correctionToolClass.saveNode.node}
     */
    saveNode(element: osmObject): Element {
        var node = document.createElement('node');

        // ID
        var id = document.createAttribute('id');
        id.value = String(element.id);
        node.setAttributeNode(id);

        // Changeset
        var changeset = document.createAttribute('changeset');
        changeset.value = this.changesetID;
        node.setAttributeNode(changeset);

        // Version
        var version = document.createAttribute('version');
        console.log(element);
        console.log(element.version + 1);
        console.log(String(element.version + 1));
        
        version.value = String(element.version);
        node.setAttributeNode(version);

        // Lat
        var lat = document.createAttribute('lat');
        lat.value = String(element.lat);
        node.setAttributeNode(lat);

        // Lon
        var lon = document.createAttribute('lon');
        lon.value = String(element.lon);
        node.setAttributeNode(lon);

        // Tags
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
    }

    /**
     * Erzeugt XML-Modifycode für Way
     * @param {OSMElement} element
     * @param int changesetID
     * @returns {Element|correctionToolClass.saveNode.node}
     */
    saveWay(element: osmObject): Element {
        var way = document.createElement('way');

        // ID
        var id = document.createAttribute('id');
        id.value = String(element.id);
        way.setAttributeNode(id);

        // Changeset
        var changeset = document.createAttribute('changeset');
        changeset.value = this.changesetID;
        way.setAttributeNode(changeset);

        // Version
        var version = document.createAttribute('version');
        version.value = String(element.version);
        way.setAttributeNode(version);

        // Tags
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

        // Nodes
        for (var key in element.nodes) {
            var nd = document.createElement('nd');

            var ref = document.createAttribute('ref');
            ref.value = String(element.nodes[key]);
            nd.setAttributeNode(ref);

            way.appendChild(nd);
        }

        return way;
    };

    /**
     * Erzeugt XML-Modifycode für Relation
     * @param {OSMElement} element
     * @param int changesetID
     * @returns {Element|correctionToolClass.saveNode.node}
     */
    saveRelation(element: osmObject): Element {
        var relation = document.createElement('relation');

        // ID
        var id = document.createAttribute('id');
        id.value = String(element.id);
        relation.setAttributeNode(id);

        // Changeset
        var changeset = document.createAttribute('changeset');
        changeset.value = this.changesetID;
        relation.setAttributeNode(changeset);

        // Version
        var version = document.createAttribute('version');
        version.value = String(element.version);
        relation.setAttributeNode(version);

        // Tags
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

        // Members
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


    /**
     * Öffne Changeset
     */
    openChangeset(): void {
        var self = this;
        this.auth.xhr({
            method: 'PUT',
            path: '/api/0.6/changeset/create',
            options: {header: {"Content-Type": "text/xml"}},
            content: '<?xml version="1.0" encoding="UTF-8"?>' +
            '<osm version="0.6" generator="JOSM">' +
            '<changeset>' +
            '<tag k="created_by" v="osmCorrection v0.0.1"/>' +
            '<tag k="comment" v="Syntax correction and validation"/>' +
            '</changeset>' +
            '</osm>'
        }, function(err: any, data: string){ self.modifyChangeset(err, data); });
    };

    private changesetID: string;
    modifyChangeset(err: any, data: string): void {
        console.log(err);
        console.log(data);
        if ((!err) && data.length > 0) {
            this.changesetID = data;
        }
        
        var modify = document.createElement('modify');

        for (var i in this.modifiedElements) {
            if (this.modifiedElements[i].type === "node") {
                modify.appendChild(this.saveNode(this.modifiedElements[i]));
            } else if (this.modifiedElements[i].type === "way") {
                modify.appendChild(this.saveWay(this.modifiedElements[i]));
            } else if (this.modifiedElements[i].type === "relation") {
                modify.appendChild(this.saveRelation(this.modifiedElements[i]));
            }
        }

        var self = this;
        this.auth.xhr({
            method: 'POST',
            path: '/api/0.6/changeset/' + this.changesetID + '/upload',
            options: {header: {"Content-Type": "text/xml"}},
            content: '<?xml version="1.0" encoding="UTF-8"?>' +
                        '<osmChange version="0.6" generator="osmCorrectionTool">'+
                            modify.outerHTML+
                        '</osmChange>'
        }, function(){ self.closeChangeset()});


    };

    /**
     * Schließe Changeset
     */
    closeChangeset(): void {
        this.auth.xhr({
            method: 'PUT',
            path: '/api/0.6/changeset/' + this.changesetID + '/close'
        }, function () {});
    };

    /**
     * Speichere Änderungen in OSM
     * @returns {Boolean}
     */
    save(): boolean {
        console.log(this.modifiedElements);
        if (this.modifiedElements.length > 0) {
            this.openChangeset();
        } else {
            console.log(this.modifiedElements);
        }
        return false;
    };
};