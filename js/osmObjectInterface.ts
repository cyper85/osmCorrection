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
import { correctionObjectClass } from "./correctionObject";

export interface osmObject {
    type:   string;
    id:     string;
    version:    number;
    tags:   {[key: string]: string};
    // Nodes:
    lat:    number;
    lon:    number;
    // Ways:
    nodes: string[];
    // Relations:
    members: {
        type: string;
        ref: string;
        role: string;
    }[];
}


export interface overpassObject {
    version:   string;
    generator:     string;
    osm3s:   {
        timestamp_osm_base: string;
        copyright: string
    };
    elements: osmObject[];
}


export interface syntaxErrorObject {
    element:    osmObject;
    tag:    string;
    plugin: correctionObjectClass;
}

