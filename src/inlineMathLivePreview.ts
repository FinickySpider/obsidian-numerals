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
import { RangeSetBuilder, Extension } from "@codemirror/state";
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
		span.setAttribute('data-numerals-inline', 'true');

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
		return false;
	}

	eq(other: InlineMathWidget): boolean {
		return other.expression === this.expression;
	}
}

/**
 * Creates a ViewPlugin for Live Preview mode inline math rendering
 * Uses regex matching to find inline code with mathexpr pattern
 */
export function createInlineMathViewPlugin(
	getScopeForFile: (path: string) => NumeralsScope | undefined,
	numberFormat: mathjsFormat,
	preProcessors: StringReplaceMap[]
): Extension {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged || update.selectionSet) {
					this.decorations = this.buildDecorations(update.view);
				}
			}

			buildDecorations(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();

				// Get the file path from Obsidian's app
				let filePath = '';
				try {
					// @ts-ignore - Access Obsidian's internal app structure
					const app = (view as any).app || (window as any).app;
					if (app && app.workspace) {
						const activeFile = app.workspace.getActiveFile();
						if (activeFile) {
							filePath = activeFile.path;
						}
					}
				} catch (e) {
					// Fallback - will work without file-specific scope
				}
				
				// Get scope for this file
				const scope = getScopeForFile(filePath);

				// Regex to match inline code with mathexpr pattern
				const mathexprRegex = /`mathexpr:\s*([^`]+)`/g;

				for (const { from, to } of view.visibleRanges) {
					const text = view.state.doc.sliceString(from, to);
					let match;
					
					// Find all mathexpr inline code in the visible range
					while ((match = mathexprRegex.exec(text)) !== null) {
						const matchStart = from + match.index;
						const matchEnd = matchStart + match[0].length;
						const expression = match[1].trim();

						// Create a widget to replace the inline code
						const widget = new InlineMathWidget(
							expression,
							scope,
							numberFormat,
							preProcessors
						);

						// Replace the inline code with the widget
						builder.add(
							matchStart,
							matchEnd,
							Decoration.replace({
								widget,
								inclusive: false,
								block: false
							})
						);
					}
				}

				return builder.finish();
			}
		},
		{
			decorations: (v) => v.decorations,
		}
	);
}
