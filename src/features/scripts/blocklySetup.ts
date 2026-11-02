import { BLOCK_COLOURS, BLOCK_DEFINITIONS, EVENT_BLOCK_STYLE, buildToolbox } from '../../engine/scripting/blocks/definitions';

/**
 * Lazily loads Blockly (it is large) and registers the Zino blocks, themes
 * and field validators exactly once.
 */

type BlocklyModule = typeof import('blockly/core');

let loading: Promise<BlocklyModule> | null = null;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(['self', 'other', 'dt', 'on', 'var', 'let', 'if', 'else', 'repeat', 'while', 'function', 'return', 'break', 'continue', 'true', 'false', 'null']);

export function loadBlockly(): Promise<BlocklyModule> {
  if (!loading) {
    loading = (async () => {
      const Blockly = await import('blockly/core');
      const En = await import('blockly/msg/en');
      Blockly.setLocale(En as unknown as Record<string, string>);

      // Variable names must be valid Zino identifiers; fix them as the user types.
      if (!Blockly.Extensions.isRegistered('zino_name_validator')) {
        Blockly.Extensions.register('zino_name_validator', function (this: import('blockly/core').Block) {
          const field = this.getField('NAME');
          field?.setValidator((value: string) => {
            const cleaned = String(value).replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
            const fixed = /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
            if (!fixed || !IDENT.test(fixed) || RESERVED.has(fixed)) return null;
            return fixed;
          });
        });
      }
      const defs = BLOCK_DEFINITIONS.map((d) =>
        ['zino_var_create', 'zino_var_set', 'zino_var_change', 'zino_var_get'].includes(String(d.type))
          ? { ...d, extensions: ['zino_name_validator'] }
          : d,
      );
      Blockly.common.defineBlocksWithJsonArray(defs);
      return Blockly;
    })().catch((err: unknown) => {
      loading = null;
      throw err;
    });
  }
  return loading;
}

export function zinoTheme(Blockly: BlocklyModule, dark: boolean) {
  const name = dark ? 'zino-dark' : 'zino-light';
  return Blockly.Theme.defineTheme(name, {
    name,
    base: Blockly.Themes.Classic,
    blockStyles: {
      [EVENT_BLOCK_STYLE]: {
        colourPrimary: BLOCK_COLOURS.events,
        colourSecondary: '#f7c46c',
        colourTertiary: '#c98a22',
        hat: 'cap',
      },
    },
    componentStyles: dark
      ? {
          workspaceBackgroundColour: '#10172b',
          toolboxBackgroundColour: '#151d33',
          toolboxForegroundColour: '#e9eefb',
          flyoutBackgroundColour: '#1b2440',
          flyoutForegroundColour: '#e9eefb',
          flyoutOpacity: 0.96,
          scrollbarColour: '#34416a',
          insertionMarkerColour: '#ffffff',
          insertionMarkerOpacity: 0.3,
          cursorColour: '#5b8cff',
        }
      : {
          workspaceBackgroundColour: '#f4f7fd',
          toolboxBackgroundColour: '#ffffff',
          toolboxForegroundColour: '#17203a',
          flyoutBackgroundColour: '#eef2f9',
          flyoutForegroundColour: '#17203a',
          flyoutOpacity: 0.97,
          scrollbarColour: '#c5cfe3',
          insertionMarkerColour: '#000000',
          insertionMarkerOpacity: 0.2,
          cursorColour: '#3769f5',
        },
    fontStyle: { family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', weight: '600', size: 12 },
    startHats: true,
  });
}

export { buildToolbox };
