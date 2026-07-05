/* @ds-bundle: {"namespace":"LookeyDS","components":[{"name":"Button","sourcePath":"components/general/Button/Button.jsx"},{"name":"FAQItem","sourcePath":"components/general/FAQItem/FAQItem.jsx"},{"name":"FeatureCard","sourcePath":"components/general/FeatureCard/FeatureCard.jsx"},{"name":"Footer","sourcePath":"components/general/Footer/Footer.jsx"},{"name":"FormField","sourcePath":"components/general/FormField/FormField.jsx"},{"name":"Modal","sourcePath":"components/general/Modal/Modal.jsx"},{"name":"Navbar","sourcePath":"components/general/Navbar/Navbar.jsx"},{"name":"SecurityCard","sourcePath":"components/general/SecurityCard/SecurityCard.jsx"},{"name":"StepCard","sourcePath":"components/general/StepCard/StepCard.jsx"},{"name":"TestimonialCard","sourcePath":"components/general/TestimonialCard/TestimonialCard.jsx"}],"sourceHashes":{"components/general/Button/Button.jsx":"cf399edbbc13","components/general/Button/Button.d.ts":"23675d1143ae","components/general/Button/Button.prompt.md":"54571578aa24","components/general/FAQItem/FAQItem.jsx":"87cdc7390ec1","components/general/FAQItem/FAQItem.d.ts":"f6b53f7f39a7","components/general/FAQItem/FAQItem.prompt.md":"ba46d0bac273","components/general/FeatureCard/FeatureCard.jsx":"cfd18f74bcd6","components/general/FeatureCard/FeatureCard.d.ts":"d88f9df0198c","components/general/FeatureCard/FeatureCard.prompt.md":"b2e6629b7210","components/general/Footer/Footer.jsx":"fec339343a85","components/general/Footer/Footer.d.ts":"f2bf997a1808","components/general/Footer/Footer.prompt.md":"79a040947f37","components/general/FormField/FormField.jsx":"d6a28cde6ded","components/general/FormField/FormField.d.ts":"e3402c8148bc","components/general/FormField/FormField.prompt.md":"cdb456e9d183","components/general/Modal/Modal.jsx":"f7fa4d67481d","components/general/Modal/Modal.d.ts":"2045551d09a5","components/general/Modal/Modal.prompt.md":"7bad95ad2160","components/general/Navbar/Navbar.jsx":"ec825853873f","components/general/Navbar/Navbar.d.ts":"36de44164838","components/general/Navbar/Navbar.prompt.md":"29cfe1629b7c","components/general/SecurityCard/SecurityCard.jsx":"040d09c878d9","components/general/SecurityCard/SecurityCard.d.ts":"b93c2fa87903","components/general/SecurityCard/SecurityCard.prompt.md":"3b72548909a0","components/general/StepCard/StepCard.jsx":"ad089bceae83","components/general/StepCard/StepCard.d.ts":"75595d3c6949","components/general/StepCard/StepCard.prompt.md":"85181bc296cd","components/general/TestimonialCard/TestimonialCard.jsx":"bf36ada17f38","components/general/TestimonialCard/TestimonialCard.d.ts":"c3a730bafa1c","components/general/TestimonialCard/TestimonialCard.prompt.md":"16b9792e4802"},"inlinedExternals":[],"builtBy":"cc-design-sync"} */
"use strict";
var LookeyDS = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // <define:import.meta.env>
  var init_define_import_meta_env = __esm({
    "<define:import.meta.env>"() {
    }
  });

  // shim:react-shim
  var require_react_shim = __commonJS({
    "shim:react-shim"(exports, module) {
      init_define_import_meta_env();
      var R = window.React;
      function np(p2, k) {
        var o = {};
        for (var x in p2) if (x !== "children") o[x] = p2[x];
        if (k !== void 0) o.key = k;
        return o;
      }
      function jsx(t, p2, k) {
        var c = p2 && p2.children;
        return c === void 0 ? R.createElement(t, np(p2, k)) : R.createElement(t, np(p2, k), c);
      }
      function jsxs(t, p2, k) {
        return R.createElement.apply(R, [t, np(p2, k)].concat(p2.children));
      }
      module.exports = R;
      module.exports.jsx = jsx;
      module.exports.jsxs = jsxs;
      module.exports.jsxDEV = function(t, p2, k, s) {
        return (s ? jsxs : jsx)(t, p2, k);
      };
      module.exports.Fragment = R.Fragment;
    }
  });

  // lookey-ds/dist/index.es.js
  var index_es_exports = {};
  __export(index_es_exports, {
    Button: () => u,
    FAQItem: () => j,
    FeatureCard: () => h,
    Footer: () => B,
    FormField: () => y,
    Modal: () => b,
    Navbar: () => v,
    SecurityCard: () => N,
    StepCard: () => f,
    TestimonialCard: () => p
  });
  init_define_import_meta_env();
  var import_jsx_runtime = __toESM(require_react_shim(), 1);
  function u({
    variant: a = "primary",
    className: r,
    children: e,
    ...c
  }) {
    const n = ["lk-root", "lk-btn", `lk-btn--${a}`, r].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: n, ...c, children: e });
  }
  function h({
    icon: a,
    title: r,
    children: e,
    theme: c = "blue",
    className: n
  }) {
    const s = ["lk-root", "lk-feature-card", `lk-feature-card--${c}`, n].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: s, children: [
      a != null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "lk-feature-card__icon", children: a }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "lk-feature-card__title", children: r }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "lk-feature-card__body", children: e })
    ] });
  }
  function f({
    number: a,
    icon: r,
    title: e,
    children: c,
    theme: n = "blue",
    className: s
  }) {
    const o = ["lk-root", "lk-step-card", `lk-step-card--${n}`, s].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: o, children: [
      a != null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "lk-step-card__number", children: a }),
      r != null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "lk-step-card__icon", children: r }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { className: "lk-step-card__title", children: e }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "lk-step-card__body", children: c })
    ] });
  }
  function N({
    title: a,
    children: r,
    accent: e = "blue",
    className: c
  }) {
    const n = [
      "lk-root",
      "lk-security-card",
      `lk-security-card--${e}`,
      c
    ].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: n, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "lk-security-card__dot" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { className: "lk-security-card__title", children: a }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "lk-security-card__body", children: r })
    ] });
  }
  function p({
    quote: a,
    author: r,
    role: e,
    rating: c = 5,
    avatarUrl: n,
    className: s
  }) {
    const o = ["lk-root", "lk-testimonial-card", s].filter(Boolean).join(" "), t = Math.max(0, Math.min(5, Math.round(c)));
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: o, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "lk-testimonial-card__stars", "aria-label": `${t} out of 5 stars`, children: [
        "\u2605".repeat(t),
        "\u2606".repeat(5 - t)
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "lk-testimonial-card__text", children: a }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "lk-testimonial-card__author", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "div",
          {
            className: "lk-testimonial-card__avatar",
            style: n ? { backgroundImage: `url(${n})` } : void 0
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "lk-testimonial-card__name", children: r }),
          e != null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "lk-testimonial-card__role", children: e })
        ] })
      ] })
    ] });
  }
  function v({
    brand: a = "Look",
    brandAccent: r = "ey",
    links: e = [],
    cta: c,
    className: n
  }) {
    const s = ["lk-root", "lk-navbar", n].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", { className: s, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "lk-navbar__inner", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "lk-navbar__logo", children: [
        a,
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: r })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "lk-navbar__links", children: e.map((o, t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: o.href, children: o.label }) }, t)) }),
      c != null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "lk-navbar__cta", children: c })
    ] }) });
  }
  function b({
    title: a,
    children: r,
    open: e = true,
    onClose: c,
    className: n
  }) {
    if (!e) return null;
    const s = ["lk-modal", n].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "lk-root lk-modal__overlay", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: s, role: "dialog", "aria-modal": "true", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "lk-modal__header", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { className: "lk-modal__title", children: a }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            className: "lk-modal__close",
            "aria-label": "Close",
            onClick: c,
            children: "\xD7"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "lk-modal__body", children: r })
    ] }) });
  }
  function y({
    label: a,
    as: r = "input",
    placeholder: e,
    type: c = "text",
    children: n,
    value: s,
    onChange: o,
    id: t,
    className: m
  }) {
    const d = ["lk-root", "lk-field", m].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: d, children: [
      a != null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("label", { className: "lk-field__label", htmlFor: t, children: a }),
      r === "textarea" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "textarea",
        {
          id: t,
          className: "lk-field__control",
          placeholder: e,
          value: s,
          onChange: o
        }
      ) : r === "select" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "select",
        {
          id: t,
          className: "lk-field__control",
          value: s,
          onChange: o,
          children: n
        }
      ) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "input",
        {
          id: t,
          className: "lk-field__control",
          type: c,
          placeholder: e,
          value: s,
          onChange: o
        }
      )
    ] });
  }
  function j({
    question: a,
    children: r,
    open: e = false,
    onToggle: c,
    className: n
  }) {
    const s = [
      "lk-root",
      "lk-faq-item",
      e ? "lk-faq-item--open" : "",
      n
    ].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: s, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
        "button",
        {
          type: "button",
          className: "lk-faq-item__question",
          "aria-expanded": e,
          onClick: c,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: a }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "lk-faq-item__icon", "aria-hidden": true, children: "\u25BE" })
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "lk-faq-item__answer", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: r }) })
    ] });
  }
  function B({
    brand: a = "Look",
    brandAccent: r = "ey",
    tagline: e,
    columns: c = [],
    copyright: n,
    className: s
  }) {
    const o = ["lk-root", "lk-footer", s].filter(Boolean).join(" ");
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { className: o, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "lk-footer__inner", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "lk-footer__column", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "lk-footer__logo", children: [
            a,
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: r })
          ] }),
          e != null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: e })
        ] }),
        c.map((t, m) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "lk-footer__column", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: t.heading }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { className: "lk-footer__links", children: t.links.map((d, _) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", { href: d.href, children: d.label }) }, _)) })
        ] }, m))
      ] }),
      n != null && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "lk-footer__bottom", children: n })
    ] });
  }
  return __toCommonJS(index_es_exports);
})();
window.LookeyDS=LookeyDS.__dsMainNs?Object.assign({},LookeyDS,LookeyDS.__dsMainNs,{__dsMainNs:undefined}):LookeyDS;
