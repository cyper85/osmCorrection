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
    var correctionObjectClass = (function () {
        function correctionObjectClass() {
            this.id = "";
            this.syntaxEditor = function (tag, element) { };
        }
        correctionObjectClass.prototype.getTags = function () {
            return this.downloadTags;
        };
        correctionObjectClass.prototype.done = function () {
            correctionTool.registerObject(this);
        };
        correctionObjectClass.prototype.correctionObjectClass = function () { };
        correctionObjectClass.prototype.editorForm = function (label, value, type) {
            if (type === void 0) { type = "error"; }
            var div = $('<div />').addClass("syntaxElement").addClass("form-group").addClass("panel").addClass("panel-" + type).append($("<label />").attr("for", "input").addClass("control-label").addClass("panel-heading").html(label)).append($("<input />").attr("id", "input").addClass("form-control").addClass("panel-body").attr("type", "text").attr("pattern", "\\+(?:[0-9][ -]?){6,14}[0-9]").val(value));
            var form = $('<form />').attr("role", "form").append(div).append($("<button />").addClass("btn").addClass("btn-success").html("weiter").click(correctionTool.syntaxCorrection));
            return form;
        };
        return correctionObjectClass;
    }());
    exports.correctionObjectClass = correctionObjectClass;
});
//# sourceMappingURL=correctionObject.js.map