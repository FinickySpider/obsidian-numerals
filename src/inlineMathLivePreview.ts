/**
 * Live Preview support for inline math expressions
 * Uses CodeMirror 6 ViewPlugin to render mathexpr inline code in editing mode
 */

import {
	EditorView,
	Decoration,
	DecorationSet,
	ViewPlugin,
	ViewUpdate,
	WidgetType
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder } from "@codemirror/state";
import * as math from 'mathjs';
import { NumeralsScope, mathjsFormat, StringReplaceMap } from './numerals.types';
import { replaceStringsInTextFromMap } from './numeralsUtilities';

/**
 * Widget that replaces inline code with evaluated result in Live Preview
 */
class InlineMathWidget extends WidgetType {
	constructor(
		private expression: string,
		private scope: NumeralsScope | undefined,
		private numberFormat: mathjsFormat,
		private preProcessors: StringReplaceMap[]
	) {
		super();
	}

	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.classList.add('numerals-inline-result');

		try {
			// Apply preprocessors to the expression
			let processedExpression = this.expression;
			if (this.preProcessors && this.preProcessors.length > 0) {
				processedExpression = replaceStringsInTextFromMap(processedExpression, this.preProcessors);
			}

			// Evaluate the expression using the page scope
			const result = math.evaluate(processedExpression, this.scope || new NumeralsScope());

			// Format the result
			const formattedResult = math.format(result, this.numberFormat);
			span.textContent = formattedResult;
		} catch (error) {
			span.classList.remove('numerals-inline-result');
			span.classList.add('numerals-inline-error');
			span.textContent = `[Error: ${error.message || 'Invalid expression'}]`;
		}

		return span;
	}

	// Prevent cursor from entering the widget
	ignoreEvent(): boolean {
		return true;
	}
}

/**
 * Creates a ViewPlugin for Live Preview mode inline math rendering
 */
export function createInlineMathViewPlugin(
	getScopeForFile: (path: string) => NumeralsScope | undefined,
	numberFormat: mathjsFormat,
	preProcessors: StringReplaceMap[]
) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = this.buildDecorations(update.view);
				}
			}

			buildDecorations(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();

				for (const { from, to } of view.visibleRanges) {
					syntaxTree(view.state).iterate({
						from,
						to,
						enter: (node) => {
							// Look for inline code nodes
							if (node.name === "InlineCode") {
								const text = view.state.doc.sliceString(node.from, node.to);
								
								// Match the pattern `mathexpr: expression`
								// The text includes the backticks
								const codeMatch = text.match(/^`(mathexpr:\s*(.+))`$/);
								if (codeMatch) {
									const expression = codeMatch[2].trim();
									
									// Get the file path - try to access from view state
									let filePath = '';
									try {
										// @ts-ignore - Obsidian's internal API
										const file = view.state.field?.editorLivePreviewField?.file;
										if (file) {
											filePath = file.path;
										} else {
											// Try alternative method
											// @ts-ignore
											const activeFile = view.state?.field?.stateField?.file;
											if (activeFile) {
												filePath = activeFile.path;
											}
										}
									} catch (e) {
										// Fallback - will work without file-specific scope
									}
									
									// Get scope for this file
									const scope = getScopeForFile(filePath);

									// Create a widget to replace the inline code
									const widget = new InlineMathWidget(
										expression,
										scope,
										numberFormat,
										preProcessors
									);

									// Replace the inline code with the widget
									builder.add(
										node.from,
										node.to,
										Decoration.replace({
											widget,
										})
									);
								}
							}
						}
					});
				}

				return builder.finish();
			}
		},
		{
			decorations: (v) => v.decorations,
		}
	);
}
