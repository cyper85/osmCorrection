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


var coTel = new correctionObjectClass();

coTel.id = "tel";
coTel.downloadTags = ["contact:phone", "phone", "contact:fax", "fax"];

coTel.correctingSyntax = function(element) {
    var answer = [];
    if(typeof element.tags !== "undefined") {
        var regex = /^\+(?:[0-9][ -]?){6,14}[0-9]$/;
        for (var key in this.downloadTags ) {
            if(typeof element.tags[this.downloadTags[key]] !== "undefined") {
                if (!regex.test(element.tags[this.downloadTags[key]])) {
                    answer.push(this.downloadTags[key]);
                }
            }
        }
    }
    return answer;
};

coTel.syntaxEditor = function(tag,element) {
    $('#syntax').html("");
    $('#syntax').append(coTel.editorForm(tag,element.tags[tag]));
    $('#syntax form').validator();
    $('#syntax form input').focus();
};

coTel.done();