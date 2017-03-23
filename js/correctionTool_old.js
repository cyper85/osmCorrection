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

if (typeof map === "undefined") {
    /**
     * global map var
     * @type Leaflet
     */
    var map;
}

var correctionToolClass = function () {
    /**
     * correctionObjects
     * @type Array
     */
    var callbacks = [];

    this.registerObject = function (obj) {
        callbacks.push(obj);
        for(var tag in obj.downloadTags) {
            overpassQuery(obj.downloadTags[tag]);
        }
    };

    var overpassQuery = function (option) {
        var bounds = map.getBounds().getSouth() + ',' + map.getBounds().getWest() + ',' + map.getBounds().getNorth() + ',' + map.getBounds().getEast();

        $.getJSON("https://overpass-api.de/api/interpreter",
                {"data": '[out:json][timeout:25];(node["' + option + '"](' + bounds + ');way["' + option + '"](' + bounds + ');relation["' + option + '"](' + bounds + '););out body;>;out skel qt;'},
                correctData
                );
    };
    
    var nodes = {};
    var ways = {};
    var relations = {};
    var syntaxErrors = [];
    var syntaxFlag = true;

    var correctData = function (data) {
        for (var i = 0; i < data.elements.length; i++) {
            if (data.elements[i].type === "node") {
                if(typeof nodes[data.elements[i].id] !== "undefined") {
                    continue;
                }
                nodes[data.elements[i].id] = data.elements[i];
            } else if (data.elements[i].type === "way") {
                if(typeof ways[data.elements[i].id] !== "undefined") {
                    continue;
                }
                ways[data.elements[i].id] = data.elements[i];
            } else if (data.elements[i].type === "relation") {
                if(typeof relations[data.elements[i].id] !== "undefined") {
                    continue;
                }
                relations[data.elements[i].id] = data.elements[i];
            }
            if (typeof data.elements[i].tags !== "undefined") {
                var correct = false;
                for(var key in callbacks) {
                    correct = callbacks[key].correctingSyntax(data.elements[i]);
                    if(correct.length>0) {
                        for(var cKey in correct) {
                            syntaxErrors.push({
                                element: data.elements[i],
                                tag: correct[cKey],
                                plugin: callbacks[key]
                            });
                        }
                    }
                }
            }
        }
        if(syntaxFlag && (syntaxErrors.length>0)) {
            syntaxFlag = false;
            syntaxEditor();
        }
    };
    
    var modifiedElements = [];
    
    var syntaxError;
    
    var syntaxEditor = function () {
        syntaxError = syntaxErrors.shift();
        showElement(syntaxError.element);
        syntaxError.plugin.syntaxEditor(syntaxError.tag,syntaxError.element);
    };
    
    
    var shownElement = new L.FeatureGroup();;
    var shownElementBounds;
    
    var showNode = function(element) {
        shownElement.addLayer(new L.circle(L.latLng(element.lat, element.lon),3));
        if(shownElementBounds === null) {
            shownElementBounds = new L.latLngBounds(L.latLng(element.lat, element.lon),L.latLng(element.lat, element.lon));
        } else {
            shownElementBounds = shownElementBounds.extends(L.latLng(element.lat, element.lon));
        }
    };
    
    var showWay = function(element) {
        var way = [];
        for(var i in element.nodes) {
            console.log(nodes[element.nodes[i]]);
            way.push(L.latLng(nodes[element.nodes[i]].lat,nodes[element.nodes[i]].lon));
        }
        if(element.nodes[0] === element.nodes[element.nodes.length - 1]) {
            shownElement.addLayer(L.polygon(way));
        } else {
            shownElement.addLayer(L.polyline(way));
        }
        if(shownElementBounds === null) {
            shownElementBounds = new L.latLngBounds(way);
        } else {
            for(var i in way) {
                shownElementBounds = shownElementBounds.extends(way[i]);
            }
        }
    };
    
    var showRelation = function(element) {
        console.log("bah");
    };
    
    var showElement = function(element) {
        shownElementBounds = null;
        map.removeLayer(shownElement);
        shownElement.clearLayers();
        
        if(element.type === "node") {
            showNode(element);
        } else if (element.type === "way") {
            showWay(element);
        } else if (element.type === "relation") {
            showRelation(element);
        }
        map.addLayer(shownElement);
        
        map.fitBounds(shownElementBounds);
    };
    
    this.syntaxCorrection = function() {
        
        var input = $('input#input').val();
        if(input !== syntaxError.element.tags[syntaxError.tag]) {
            syntaxError.element.tags[syntaxError.tag] = input;
            if(modifiedElements.indexOf(syntaxError.element) != -1) {
                modifiedElements.splice(modifiedElements.indexOf(syntaxError.element),1);
            }
            modifiedElements.push(syntaxError.element);
        }
        // irgendwas speichern
        if(syntaxErrors.length > 0) {
            syntaxEditor();
        } else {
            $('#syntax').html("");
            document.getElementById("stateTwo").classList.add("hidden");
            document.getElementById("stateThree").classList.remove("hidden");
        }
    };
    
    /**
     * Erzeugt XML-Modifycode für Node
     * @param {OSMElement} element
     * @param int changesetID
     * @returns {Element|correctionToolClass.saveNode.node}
     */
    var saveNode = function(element,changesetID) {
        var node = document.createElement('node');
        
        // ID
        var id = document.createAttribute('id');
        id.value = element.id;
        node.setAttributeNode(id);
        
        // Changeset
        var changeset = document.createAttribute('changeset');
        changeset.value = changesetID;
        node.setAttributeNode(changeset);
        
        // Version
        var version = document.createAttribute('version');
        version.value = element.version+1;
        node.setAttributeNode(version);
        
        // Lat
        var lat = document.createAttribute('lat');
        lat.value = element.lat;
        node.setAttributeNode(lat);
        
        // Lon
        var lon = document.createAttribute('lon');
        lon.value = element.lon;
        node.setAttributeNode(lon);
        
        
        return node;
    } 
    
    /**
     * Erzeugt XML-Modifycode für Way
     * @param {OSMElement} element
     * @param int changesetID
     * @returns {Element|correctionToolClass.saveNode.node}
     */
    var saveWay = function(element,changesetID) {
        
    } 
    
    /**
     * Erzeugt XML-Modifycode für Relation
     * @param {OSMElement} element
     * @param int changesetID
     * @returns {Element|correctionToolClass.saveNode.node}
     */
    var saveRelation = function(element,changesetID) {
        
    };
    
    
    /**
     * Öffne Changeset
     */
    this.openChangeset = function() {
        auth.xhr({
            method: 'PUT',
            path: '/api/0.6/changeset/create',
            content: '<?xml version="1.0" encoding="UTF-8"?>'+
                    '<osm version="0.6" generator="JOSM">'+
                    '<changeset>'+
                        '<tag k="created_by" v="osmCorrection"/>'+
                        '<tag k="comment" v="Syntax correction and validation"/>'+
                    '</changeset>'+
                '</osm>'
        }, correctionTool.modifyChangeset);
    };
    
    /**
     * Erzeuge Modify-Request für Changeset
     * @param {error} err
     * @param {xhr} data
     */
    this.modifyChangeset = function(err, data) {
        console.log(err);
        console.log(data);/*
        var osmChange = document.createElement('osmChange');
            
            //Version
            var version = document.createAttribute('version');
            version.value = '0.6';
            osmChange.setAttributeNode(version);
            
            // Generator
            var generator = document.createAttribute('generator');
            generator.value = 'osmCorrectionTool';
            osmChange.setAttributeNode(generator);
            
            var modify = document.createElement('modify');
            
            for(var i in modifiedElements) {
                if(modifiedElements[i].type === "node") {
                    modify.appendChild(saveNode(modifiedElements[i]));
                } else if(modifiedElements[i].type === "way") {
                    modify.appendChild(saveWay(modifiedElements[i]));
                } else if(modifiedElements[i].type === "relation") {
                    modify.appendChild(saveRelation(modifiedElements[i]));
                }
            }
            
            generator.appendChild(modify);*/
    };
    
    /**
     * Schließe Changeset
     */
    this.closeChangeset = function() {
        var xml = '<osm><changeset><tag k="created_by" v="osmCorrection"/><tag k="comment" v="Syntax correction and validation"/></changeset></osm>';
    };
    
    /**
     * Speichere Änderungen in OSM
     * @returns {Boolean}
     */
    this.save = function() {
        if(modifiedElements.length>0) {
            correctionTool.openChangeset();                
        } else {
            console.log(modifiedElements);
        }
        return false;
    };
};

/**
 * 
 * @type correctionToolClass
 */
var correctionTool = new correctionToolClass();

/**
 * 
 * @returns 
 */
var correctionObjectClass = function () {
    this.id = "";
    this.downloadTags = [];

    this.getTags = function() {
        return this.downloadTags;
    }
    
    this.done = function() {
        correctionTool.registerObject(this);
    };
    
    this.correctingSyntax = function(element) {};
    
    /**
     * Erstellt Syntax-Editor
     * @param {string} tag
     * @param {object} element
     * @returns {none}
     */
    this.syntaxEditor = function(tag, element) {};
    
    
    this.correctionObjectClass = function() {};
    
    this.editorForm = function(label,value,type) {
        var div = $('<div />').addClass("syntaxElement").addClass("form-group").addClass("panel").addClass("panel-"+type).append(
            $("<label />").attr("for","input").addClass("control-label").addClass("panel-heading").html(label)).append(
            $("<input />").attr("id","input").addClass("form-control").addClass("panel-body").attr("type","text").attr("pattern","\\+(?:[0-9][ -]?){6,14}[0-9]").val(value));
        var form = $('<form />').attr("role","form").append(div).append(
                $("<button />").addClass("btn").addClass("btn-success").html("weiter").click(correctionTool.syntaxCorrection));
        return form;
        $('#syntax').html("");
        $('#syntax').append(form);
        $('#syntax form').validator();
        $('#syntax form input').focus();
    };
    
};
