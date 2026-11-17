/**
 * Plain-language notes for the axe rules that show up most often.
 * Each entry says what the problem is, who it affects, the usual fix, and who usually does the fix.
 * Rules not listed here fall back to a generic note built from the rule id.
 */

export type Effort = "quick" | "moderate" | "larger";

export type RuleGuide = {
  /** Short name a non-specialist would recognise. */
  title: string;
  /** What is wrong, and who it affects. */
  why: string;
  /** What usually fixes it. */
  fix: string;
  /** Who usually makes the change. */
  owner: string;
  /**
   * quick: one template or setting change, often clears the problem on every page.
   * moderate: needs a developer or designer and some care on each page type.
   * larger: needs review of a lot of content or components.
   */
  effort: Effort;
};

export const EFFORT_LABEL: Record<Effort, string> = {
  quick: "Often a quick fix",
  moderate: "Moderate effort",
  larger: "Bigger job",
};

export const RULE_GUIDE: Record<string, RuleGuide> = {
  "color-contrast": {
    title: "Text is hard to read against its background",
    why: "Pale text on a light background, or dark text on a dark one, is hard to read for people with low vision and for anyone on a bright screen.",
    fix: "Darken the text or lighten the background until it reaches a 4.5 to 1 contrast ratio (3 to 1 for large text). Change the color in the site's theme once instead of page by page.",
    owner: "Designers and whoever owns the site theme",
    effort: "moderate",
  },
  "link-name": {
    title: "Links with no readable name",
    why: "A screen reader announces only the word \"link\", so the person can't tell where it goes. Icon links and image links are the usual cause.",
    fix: "Give every link text that says where it goes. For an icon link, add an aria-label or visually hidden text.",
    owner: "Developers and content editors",
    effort: "quick",
  },
  "image-alt": {
    title: "Images with no text description",
    why: "People who can't see the image get nothing, or hear a file name.",
    fix: "Add short alt text that says what the image shows or does. Use empty alt text (alt=\"\") for purely decorative images so screen readers skip them.",
    owner: "Content editors",
    effort: "moderate",
  },
  "input-image-alt": {
    title: "Image buttons with no text description",
    why: "A screen reader can't say what the button does.",
    fix: "Add alt text that names the action, such as \"Search\".",
    owner: "Developers",
    effort: "quick",
  },
  "button-name": {
    title: "Buttons with no name",
    why: "A screen reader announces \"button\" and nothing else. Icon-only buttons are the usual cause.",
    fix: "Add visible text or an aria-label that names the action, such as \"Open menu\".",
    owner: "Developers",
    effort: "quick",
  },
  "input-button-name": {
    title: "Form buttons with no name",
    why: "A screen reader can't say what the button does.",
    fix: "Give the button a value or label that names the action.",
    owner: "Developers",
    effort: "quick",
  },
  label: {
    title: "Form fields with no label",
    why: "People using a screen reader don't know what to type. Voice control users can't say the field's name to reach it.",
    fix: "Connect every field to a visible label. Placeholder text on its own isn't a label.",
    owner: "Developers",
    effort: "moderate",
  },
  "select-name": {
    title: "Drop-down menus with no label",
    why: "A screen reader user hears a list of options without knowing what is being chosen.",
    fix: "Connect the drop-down to a visible label.",
    owner: "Developers",
    effort: "moderate",
  },
  "html-has-lang": {
    title: "Page language isn't set",
    why: "Screen readers guess the language and can read the whole page in the wrong accent.",
    fix: "Add the language to the page's html tag, for example lang=\"en\". It is usually one line in the site template.",
    owner: "Developers",
    effort: "quick",
  },
  "html-lang-valid": {
    title: "Page language code is wrong",
    why: "Screen readers can't pick the right voice.",
    fix: "Replace the value in the html tag's lang attribute with a valid code such as \"en\" or \"es\".",
    owner: "Developers",
    effort: "quick",
  },
  "valid-lang": {
    title: "A language code on the page is wrong",
    why: "Screen readers can't pick the right voice for that passage.",
    fix: "Correct the lang attribute on that element.",
    owner: "Developers",
    effort: "quick",
  },
  "document-title": {
    title: "Page has no title",
    why: "The title is the first thing a screen reader reads and what shows in browser tabs and search results.",
    fix: "Give every page a short, specific title.",
    owner: "Developers and content editors",
    effort: "quick",
  },
  "frame-title": {
    title: "Embedded frames with no title",
    why: "Screen reader users can't tell what an embedded map, video or widget is before entering it.",
    fix: "Add a title attribute to each iframe that says what it contains.",
    owner: "Developers",
    effort: "quick",
  },
  bypass: {
    title: "No way to skip past the menu",
    why: "Keyboard and screen reader users have to tab through the whole navigation on every page.",
    fix: "Add a \"Skip to main content\" link as the first thing on the page, and make sure it points to something.",
    owner: "Developers",
    effort: "quick",
  },
  "meta-viewport": {
    title: "Zooming is switched off",
    why: "People who need larger text can't pinch to zoom on a phone.",
    fix: "Remove user-scalable=no and any maximum-scale limit from the viewport tag.",
    owner: "Developers",
    effort: "quick",
  },
  "link-in-text-block": {
    title: "Links in text are only told apart by color",
    why: "People who can't tell the colors apart can't see which words are links.",
    fix: "Underline links inside paragraphs, or give them another clear marker.",
    owner: "Designers",
    effort: "quick",
  },
  "label-content-name-mismatch": {
    title: "Visible label differs from the name given to assistive technology",
    why: "People who use voice control say the words they can see, such as \"Search\", and nothing happens because the control's hidden name is different. Screen reader users also hear a name that doesn't match the screen.",
    fix: "Make the accessible name (aria-label or similar) start with the visible text, or remove the aria-label so the visible text is used.",
    owner: "Developers",
    effort: "moderate",
  },
  "aria-hidden-focus": {
    title: "Hidden content can still be tabbed to",
    why: "Keyboard users land on things they can't see or hear, which is confusing.",
    fix: "Make hidden items unfocusable as well, or stop hiding them from assistive technology.",
    owner: "Developers",
    effort: "moderate",
  },
  "aria-allowed-attr": {
    title: "Wrong accessibility attributes on an element",
    why: "Assistive technology can announce the element incorrectly.",
    fix: "Remove the attribute or use the correct one for that element's role.",
    owner: "Developers",
    effort: "moderate",
  },
  "aria-required-attr": {
    title: "Missing accessibility attributes",
    why: "Custom controls can't be used properly with a screen reader.",
    fix: "Add the attributes the role requires, or use the standard HTML element instead.",
    owner: "Developers",
    effort: "moderate",
  },
  "aria-required-children": {
    title: "Custom widget is missing parts",
    why: "A menu, list or tab set that is missing required parts is announced wrongly.",
    fix: "Add the missing parts, or use plain HTML elements.",
    owner: "Developers",
    effort: "moderate",
  },
  "aria-required-parent": {
    title: "Custom widget part sits in the wrong place",
    why: "Assistive technology can't work out how the parts fit together.",
    fix: "Put the element inside the parent that its role needs.",
    owner: "Developers",
    effort: "moderate",
  },
  "aria-roles": {
    title: "Unknown role on an element",
    why: "Assistive technology ignores a role it doesn't recognise.",
    fix: "Correct the role name, or remove it.",
    owner: "Developers",
    effort: "quick",
  },
  "aria-valid-attr": {
    title: "Misspelled accessibility attribute",
    why: "Assistive technology ignores it, so the intended help never arrives.",
    fix: "Correct the attribute name.",
    owner: "Developers",
    effort: "quick",
  },
  "aria-valid-attr-value": {
    title: "Accessibility attribute points at something that isn't there",
    why: "A label or description that refers to a missing element reads as blank.",
    fix: "Point the attribute at an element that exists on the page.",
    owner: "Developers",
    effort: "moderate",
  },
  "aria-input-field-name": {
    title: "Custom input with no name",
    why: "A screen reader user doesn't know what to enter.",
    fix: "Add a label or aria-label.",
    owner: "Developers",
    effort: "moderate",
  },
  "aria-command-name": {
    title: "Custom button or link with no name",
    why: "A screen reader can't say what it does.",
    fix: "Add visible text or an aria-label.",
    owner: "Developers",
    effort: "quick",
  },
  "aria-dialog-name": {
    title: "Pop-up window with no name",
    why: "A screen reader user opens a dialog without hearing what it is for.",
    fix: "Give the dialog a label that matches its heading.",
    owner: "Developers",
    effort: "quick",
  },
  "duplicate-id-aria": {
    title: "Two elements share an ID that a label depends on",
    why: "The label can attach to the wrong thing.",
    fix: "Give every element its own ID.",
    owner: "Developers",
    effort: "quick",
  },
  list: {
    title: "Lists built the wrong way",
    why: "A screen reader announces the list incorrectly or not at all.",
    fix: "Only put list items inside a list, and use real list markup.",
    owner: "Developers",
    effort: "quick",
  },
  listitem: {
    title: "List items outside a list",
    why: "A screen reader can't tell they are part of a list.",
    fix: "Wrap them in a proper list element.",
    owner: "Developers",
    effort: "quick",
  },
  "nested-interactive": {
    title: "A button or link inside another button or link",
    why: "Screen readers and voice control often can't reach the inner control.",
    fix: "Separate them so each control stands on its own.",
    owner: "Developers",
    effort: "moderate",
  },
  "scrollable-region-focusable": {
    title: "Scrolling box can't be reached by keyboard",
    why: "Keyboard users can't scroll the content inside it.",
    fix: "Make the scrolling area focusable, for example with tabindex=\"0\" and a label.",
    owner: "Developers",
    effort: "quick",
  },
  "td-headers-attr": {
    title: "Table cells point at headers that aren't there",
    why: "Screen reader users can't tell which column or row a cell belongs to.",
    fix: "Fix the headers references, or use plain header cells.",
    owner: "Developers and content editors",
    effort: "moderate",
  },
  "th-has-data-cells": {
    title: "Table headers with nothing under them",
    why: "A table used for layout, or built incorrectly, confuses screen readers.",
    fix: "Use header cells only for real headers.",
    owner: "Developers and content editors",
    effort: "moderate",
  },
  "video-caption": {
    title: "Videos with no captions",
    why: "People who are deaf or hard of hearing can't follow the video.",
    fix: "Add captions, and check automatic ones for errors before publishing.",
    owner: "Communications and content editors",
    effort: "larger",
  },
  "svg-img-alt": {
    title: "Graphics with no text description",
    why: "Screen reader users miss what the graphic shows.",
    fix: "Add a title or label that says what the graphic shows.",
    owner: "Developers and designers",
    effort: "moderate",
  },
  "role-img-alt": {
    title: "Image-like elements with no text description",
    why: "Screen reader users miss what the image shows.",
    fix: "Add alt text or an aria-label.",
    owner: "Developers",
    effort: "quick",
  },
  "area-alt": {
    title: "Clickable image map areas with no text",
    why: "Screen reader users can't tell where each area leads.",
    fix: "Add alt text to each area.",
    owner: "Developers",
    effort: "quick",
  },
  "autocomplete-valid": {
    title: "Form field autofill hints are wrong",
    why: "Browsers can't fill in personal details, which makes forms harder for many people.",
    fix: "Use a valid autocomplete value, such as \"email\" or \"postal-code\".",
    owner: "Developers",
    effort: "quick",
  },
  "form-field-multiple-labels": {
    title: "Form field with several labels",
    why: "Screen readers may read only one of them.",
    fix: "Keep one label per field.",
    owner: "Developers",
    effort: "quick",
  },
  "frame-focusable-content": {
    title: "Frame with content a keyboard can't reach",
    why: "Keyboard users can't get into the embedded content.",
    fix: "Make the content inside the frame focusable, or remove the block on tabbing.",
    owner: "Developers",
    effort: "moderate",
  },
};

/** Turn "aria-hidden-focus" into "Aria hidden focus" for rules without a guide entry. */
function humanizeRuleId(id: string): string {
  const spaced = id.replace(/[-_]+/g, " ").trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function guideFor(ruleId: string): RuleGuide & { known: boolean } {
  const g = RULE_GUIDE[ruleId];
  if (g) return { ...g, known: true };
  return {
    title: humanizeRuleId(ruleId),
    why: "An automated check flagged this. It is a WCAG failure that the testing tool can detect.",
    fix: "Search for the rule name below to see the tool's own explanation and examples of the fix.",
    owner: "Developers",
    effort: "moderate",
    known: false,
  };
}

/** axe's impact word, said the way a person would. */
export const IMPACT_LABEL: Record<string, string> = {
  critical: "Can block some people completely",
  serious: "Makes things hard for some people",
  moderate: "Causes friction",
  minor: "Minor",
};

export function impactLabel(impact: string): string {
  return IMPACT_LABEL[impact] ?? impact;
}
