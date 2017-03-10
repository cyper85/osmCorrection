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
                nodes[data.elements[i].id] = data.elements[i];
            }
            if (data.elements[i].type === "way") {
                ways[data.elements[i].id] = data.elements[i];
            }
            if (data.elements[i].type === "relation") {
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
    
    var syntaxError;
    
    var syntaxEditor = function () {
        syntaxError = syntaxErrors.shift();
        syntaxError.plugin.syntaxEditor(syntaxError.tag,syntaxError.element);
    };
    
    this.syntaxCorrection = function() {
        // irgendwas speichern
        if(syntaxErrors.length > 0) {
            syntaxEditor();
        }
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
};
