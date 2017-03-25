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

//import * as ov from "./libs/osmValidation/osmValidation.js";
import ov = require("./libs/osmValidation/osmValidation.js");

declare var correctionTool: correctionToolClass;

export abstract class correctionObjectClass {
    id = "";
    
    syntaxValidationHint: string;
    syntaxValidator: Function;
    
    downloadTags: string[];
    correctionTool: correctionToolClass;
    osmValidation: any;

    getTags() {
        return this.downloadTags;
    }
    
    constructor(correctionTool: correctionToolClass) {
        this.correctionTool = correctionTool;
        this.osmValidation = ov;
    }
    
    abstract correctingSyntax(element: osmObject):string[];
    
    editorForm(label: string, value: string, type: string = "error"):JQuery {
        var self = this;
        let div = $('<div />')
            .addClass("syntaxElement")
            .addClass("form-group")
            .addClass("panel")
            .addClass("panel-"+type)
            .append(
                $("<label />")
                    .attr("for","input")
                    .addClass("control-label")
                    .addClass("panel-heading")
                    .html(label))
            .append(
                $("<input />")
                    .attr("id","input")
                    .addClass("form-control")
                    .addClass("panel-body")
                    .attr("type","text")
                    .val(value)
                    .keyup(function(){
                        if (self.syntaxValidator($(this).val())) {
                            $(this).removeClass('invalid');
                            $(this).parent().parent().children("input[type=submit]").prop('disabled', false);
                        } else {
                            $(this).addClass('invalid');
                            $(this).parent("form").children("input[type=submit]").prop('disabled', true);
                        }
                    }));
        let form = $('<form />')
            .attr("role","form")
            .append(div)
            .append(
                $("<input />")
                    .attr("type","submit")
                    .addClass("btn")
                    .prop('disabled', true)
                    .addClass("btn-success")
                    .html("weiter")
                    .click(function(){
                        self.correctionTool.syntaxCorrection();
                    }))
            .append(
                $("<button />")
                    .addClass("btn")
                    .addClass("btn-danger")
                    .html("überspringen")
                    .click(function(){
                        self.correctionTool.syntaxCorrectionSkip();
            }));
        
        return form;
    }
    syntaxEditor(tag: string, element: osmObject) {
        $('#syntax').html("");
        $('#syntax').append(this.editorForm(tag, element.tags[tag]));
        $('#syntax form input').focus();
    }
    
}