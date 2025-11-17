/**
 * Live Preview support for inline math expressions
 * Uses CodeMirror 6 ViewPlugin with proper mode detection and cursor handling
 */

import {
	EditorView,
	Decoration,
	DecorationSet,
	ViewPlugin,
	ViewUpdate,
	WidgetType
} from "@codemirror/view";
import { RangeSetBuilder, Extension, EditorSelection } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { editorLivePreviewField } from "obsidian";
import * as math from 'mathjs';
import { NumeralsScope, mathjsFormat, StringReplaceMap } from './numerals.types';
import { replaceStringsInTextFromMap } from './numeralsUtilities';

/**
 * Widget that displays the evaluated result
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

	eq(other: InlineMathWidget): boolean {
		return other.expression === this.expression;
	}
}

/**
 * Check if cursor is within a range
 */
function cursorIntersectsRange(selection: EditorSelection, from: number, to: number): boolean {
	return selection.ranges.some(range => {
		return (range.from <= to && range.to >= from);
	});
}

/**
 * Creates a ViewPlugin for Live Preview mode inline math rendering
 * Only renders in Live Preview mode, not in Source mode
 * Hides decoration when cursor is over the inline code to allow editing
 */
export function createInlineMathViewPlugin(
	getScopeForFile: (path: string) => NumeralsScope | undefined,
	getNumberFormat: () => mathjsFormat,
	getPreProcessors: () => StringReplaceMap[]
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
				// Check if we're in Live Preview mode
				const isLivePreview = view.state.field(editorLivePreviewField);
				
				// If not in Live Preview mode (i.e., in Source mode), return no decorations
				if (!isLivePreview) {
					return Decoration.none;
				}

				const builder = new RangeSetBuilder<Decoration>();
				const selection = view.state.selection;

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
				
				// Get current format and preprocessors
				const numberFormat = getNumberFormat();
				const preProcessors = getPreProcessors();

				// Track which ranges we've already decorated to avoid duplicates
				const decoratedRanges = new Set<string>();

				for (const { from, to } of view.visibleRanges) {
					// Try syntax tree approach first
					syntaxTree(view.state).iterate({
						from,
						to,
						enter: (node) => {
							// Look for inline code nodes - try multiple possible node names
							const isInlineCode = node.name === "inline-code" || 
							                     node.name === "InlineCode" ||
							                     node.type.name === "inline-code" ||
							                     node.type.name === "InlineCode";
							
							if (isInlineCode) {
								const text = view.state.doc.sliceString(node.from, node.to);
								
								// Check if this is a mathexpr inline expression
								const match = text.match(/^`mathexpr:\s*(.+)`$/);
								if (match) {
									const expression = match[1].trim();
									const rangeKey = `${node.from}-${node.to}`;
									
									// Skip if already decorated
									if (decoratedRanges.has(rangeKey)) {
										return;
									}
									
									// Check if cursor is in this range - if so, don't decorate (allow editing)
									if (cursorIntersectsRange(selection, node.from, node.to)) {
										return;
									}

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
									
									decoratedRanges.add(rangeKey);
								}
							}
						}
					});
					
					// Fallback: regex-based search if syntax tree didn't find anything
					// This helps in cases where the syntax tree structure is different
					if (decoratedRanges.size === 0) {
						const text = view.state.doc.sliceString(from, to);
						const mathexprRegex = /`mathexpr:\s*([^`]+)`/g;
						let match;
						
						while ((match = mathexprRegex.exec(text)) !== null) {
							const matchStart = from + match.index;
							const matchEnd = matchStart + match[0].length;
							const expression = match[1].trim();
							const rangeKey = `${matchStart}-${matchEnd}`;
							
							// Skip if already decorated
							if (decoratedRanges.has(rangeKey)) {
								continue;
							}
							
							// Check if cursor is in this range - if so, don't decorate (allow editing)
							if (cursorIntersectsRange(selection, matchStart, matchEnd)) {
								continue;
							}

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
								})
							);
							
							decoratedRanges.add(rangeKey);
						}
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
