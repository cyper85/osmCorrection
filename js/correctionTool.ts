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

declare var map: L.Map;

class correctionToolClass { 
    /**
     * correctionObjects
     * @type Array
     */
    callbacks: correctionObjectClass[];

    registerObject(obj: correctionObjectClass):void {
        this.callbacks.push(obj);
        for(var tag in obj.downloadTags) {
            this.overpassQuery(obj.downloadTags[tag]);
        }
    };

    overpassQuery (option: string):void {
        let bounds = map.getBounds().getSouth() + ',' + map.getBounds().getWest() + ',' + map.getBounds().getNorth() + ',' + map.getBounds().getEast();

        $.getJSON("https://overpass-api.de/api/interpreter",
                {"data": '[out:json][timeout:25];(node["' + option + '"](' + bounds + ');way["' + option + '"](' + bounds + ');relation["' + option + '"](' + bounds + '););out body;>;out skel qt;'},
                this.correctData
                );
    };
    
    nodes: {[key: string]: osmObject};
    ways: {[key: string]: osmObject};
    relations: {[key: string]: osmObject};
    syntaxErrors: syntaxErrorObject[];
    syntaxFlag: boolean = true;

    correctData (data: overpassObject):void {
        for (let i = 0; i < data.elements.length; i++) {
            if (data.elements[i].type === "node") {
                if(typeof this.nodes[data.elements[i].id] !== "undefined") {
                    continue;
                }
                this.nodes[data.elements[i].id] = data.elements[i];
            } else if (data.elements[i].type === "way") {
                if(typeof this.ways[data.elements[i].id] !== "undefined") {
                    continue;
                }
                this.ways[data.elements[i].id] = data.elements[i];
            } else if (data.elements[i].type === "relation") {
                if(typeof this.relations[data.elements[i].id] !== "undefined") {
                    continue;
                }
                this.relations[data.elements[i].id] = data.elements[i];
            }
            if (typeof data.elements[i].tags !== "undefined") {
                let correct: string[] = [];
                for(let key in this.callbacks) {
                    correct = this.callbacks[key].correctingSyntax(data.elements[i]);
                    if(correct.length>0) {
                        for(var cKey in correct) {
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
        if(this.syntaxFlag && (this.syntaxErrors.length>0)) {
            this.syntaxFlag = false;
            this.syntaxEditor();
        }
    }
    
    modifiedElements: any[];
    syntaxError: syntaxErrorObject;
    
    syntaxEditor ():void {
        this.syntaxError = this.syntaxErrors.shift();
        this.showElement(this.syntaxError.element);
        this.syntaxError.plugin.syntaxEditor(this.syntaxError.tag,this.syntaxError.element);
    };
    
    
    shownElement: L.FeatureGroup;
    shownElementBounds: L.LatLngBounds;
    
    showNode(element: osmObject):void {
        this.shownElement.addLayer(L.circle(L.latLng(element.lat, element.lon),3));
        if(this.shownElementBounds === null) {
            this.shownElementBounds = new L.LatLngBounds(L.latLng(element.lat, element.lon),L.latLng(element.lat, element.lon));
        } else {
            this.shownElementBounds = this.shownElementBounds.extend(L.latLng(element.lat, element.lon));
        }
    };
    
    showWay(element: osmObject):void {
        let way = [];
        let shownElement;
        for(let i in element.nodes) {
            way.push(L.latLng(this.nodes[element.nodes[i]].lat,this.nodes[element.nodes[i]].lon));
        }
        if(element.nodes[0] === element.nodes[element.nodes.length - 1]) {
            shownElement = L.polygon(way);
        } else {
            shownElement = L.polyline(way);
        }
        
        this.shownElement.addLayer(shownElement);
        
        if(this.shownElementBounds === null) {
            this.shownElementBounds = shownElement.getBounds();
        } else {
            this.shownElementBounds.extend(shownElement.getBounds());
        }
    }
    
    showRelation (element:osmObject):void {
        console.log("bah");
    }
    
    showElement(element: osmObject):void {
        this.shownElementBounds = null;
        map.removeLayer(this.shownElement);
        this.shownElement.clearLayers();
        
        if(element.type === "node") {
            this.showNode(element);
        } else if (element.type === "way") {
            this.showWay(element);
        } else if (element.type === "relation") {
            this.showRelation(element);
        }
        map.addLayer(this.shownElement);
        
        map.fitBounds(this.shownElementBounds);
    };
    
    syntaxCorrection ():void {
        
        var input = $('input#input').val();
        if(input !== this.syntaxError.element.tags[this.syntaxError.tag]) {
            this.syntaxError.element.tags[this.syntaxError.tag] = input;
            if(this.modifiedElements.indexOf(this.syntaxError.element) != -1) {
                this.modifiedElements.splice(this.modifiedElements.indexOf(this.syntaxError.element),1);
            }
            this.modifiedElements.push(this.syntaxError.element);
        }
        // irgendwas speichern
        if(this.syntaxErrors.length > 0) {
            this.syntaxEditor();
        } else {
            $('#syntax').html("");
            document.getElementById("stateTwo").classList.add("hidden");
            document.getElementById("stateThree").classList.remove("hidden");
        }
    }
    
    /**
     * Erzeugt XML-Modifycode für Node
     * @param {OSMElement} element
     * @param int changesetID
     * @returns {Element|correctionToolClass.saveNode.node}
     */
    saveNode(element:any,changesetID:string):Element {
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
    saveWay(element:any,changesetID:string):Element {
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
     * Erzeugt XML-Modifycode für Relation
     * @param {OSMElement} element
     * @param int changesetID
     * @returns {Element|correctionToolClass.saveNode.node}
     */
    saveRelation(element:any,changesetID:string):Element {
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
    };
    
    
    /**
     * Öffne Changeset
     */
    openChangeset():void {
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
        }, this.modifyChangeset);
    };
    
    /**
     * Erzeuge Modify-Request für Changeset
     * @param {error} err
     * @param {xhr} data
     */
    modifyChangeset(err: any, data:Object):void {
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
    }
    
    /**
     * Schließe Changeset
     */
    closeChangeset():void {
        var xml = '<osm><changeset><tag k="created_by" v="osmCorrection"/><tag k="comment" v="Syntax correction and validation"/></changeset></osm>';
    }
    
    /**
     * Speichere Änderungen in OSM
     * @returns {Boolean}
     */
    save():boolean {
        if(this.modifiedElements.length>0) {
            this.openChangeset();                
        } else {
            console.log(this.modifiedElements);
        }
        return false;
    };
}