/// <reference path="correctionTool.ts"/>
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

import { correctionToolClass } from "./correctionTool";
import { osmObject } from "./osmObjectInterface";

declare var correctionTool: correctionToolClass;

export abstract class correctionObjectClass {
    id = "";
    downloadTags: string[];

    getTags() {
        return this.downloadTags;
    }
    
    done() {
        correctionTool.registerObject(this);
    }
    
    abstract correctingSyntax(element: osmObject):string[];
    
    syntaxEditor = function(tag: string, element: any) {}
    
    
    correctionObjectClass() {}
    
    editorForm(label: string, value: string, type: string = "error"):JQuery {
        let div = $('<div />').addClass("syntaxElement").addClass("form-group").addClass("panel").addClass("panel-"+type).append(
            $("<label />").attr("for","input").addClass("control-label").addClass("panel-heading").html(label)).append(
            $("<input />").attr("id","input").addClass("form-control").addClass("panel-body").attr("type","text").attr("pattern","\\+(?:[0-9][ -]?){6,14}[0-9]").val(value));
        let form = $('<form />').attr("role","form").append(div).append(
                $("<button />").addClass("btn").addClass("btn-success").html("weiter").click(correctionTool.syntaxCorrection));
        return form;
    }
    
}