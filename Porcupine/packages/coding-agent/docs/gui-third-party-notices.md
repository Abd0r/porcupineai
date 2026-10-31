# Browser workbench source notes and notices

The workbench adapts semantic colour values and conversation layout patterns from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), inspected at commit `22ddee3792402c3e70ec5f86a63c3e3e895a2f60` (2026-10-23). It is not a DeepSeek product, endorsement, or runtime integration. No DeepSeek logos, fonts, brand artwork, or plugin runtime are bundled.

## Source-to-adaptation map

Paths below are relative to that upstream repository.

| Upstream source inspected | Porcupine adaptation |
| --- | --- |
| `packages/client/ui-theme/src/styles/base.css` and `design-platform.css` | System typography; 4/8/12-scale radii; neutral base/sidebar/elevated surfaces; primary, secondary, caption and interaction colour roles. A small set of local semantic tokens replaces the full upstream token tree. |
| `packages/client/ui-layout/src/client/AppFrame.module.css` | Bounded grid shell with shrinking content tracks and explicit overflow ownership. Native window vibrancy and platform-specific titlebars are not imported into the browser. |
| `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css` and `ConversationContent.tsx` | Shared adaptive chat/composer width, a slightly wider composer, and a persistent composer seat. Porcupine uses a CSS container-width axis and its existing DOM/session client, not upstream React stores or slot providers. |
| `packages/client/ui-conversation/src/client/skeleton/InputBar.module.css` | A single elevated composer surface, quiet controls, and bounded input growth. No nonfunctional model/workspace/plugin selectors are shown. |
| `packages/client/ui-chat/src/client/chat/ChatView.module.css`, `MessageItem.module.css`, and `presentation-policy.ts` | Open assistant text, compact user bubbles, and progressive disclosure for secondary details. Porcupine retains its own events and permission handling. |

The `visualize` and `visualize_3d` contracts, independent input validation, Canvas rendering, uncertainty tables, and scientific teaching examples are Porcupine implementations. They are not borrowed charting capabilities from DeepSeek Harness.

## PDF.js

PDF previews use Mozilla's [PDF.js](https://github.com/mozilla/pdf.js), pinned through `pdfjs-dist` 6.4.299 under Apache License 2.0. The renderer and worker are served locally. Distribution assets include its LICENSE and the notices shipped with character maps, standard fonts, image decoders and colour profiles. Porcupine provides the preview controls and authenticated document loading; it does not use a remote viewer service.

## DeepSeek Harness license

MIT License

Copyright (c) 2026 DeepSeek

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
