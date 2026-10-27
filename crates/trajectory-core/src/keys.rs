use crate::models::{KeyIdentity, ModifierSet};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct KeyId(pub u32);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KeyKind {
    Character,
    Space,
    Enter,
    Tab,
    Escape,
    Backspace,
    Delete,
    Arrow,
    Function,
    Other,
    Modifier,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeyPress {
    pub identity: KeyIdentity,
    pub shortcut: bool,
}

pub fn classify_key_press(
    code: KeyId,
    character: Option<char>,
    modifiers: ModifierSet,
) -> Option<KeyPress> {
    let kind = key_kind(code.0);
    if kind == KeyKind::Modifier {
        return None;
    }

    let label = display_key_label(code.0, character);
    let modifier_participates = modifiers.control || modifiers.alt || modifiers.meta;
    let shift_letter = modifiers.shift
        && character
            .map(|ch| ch.is_alphabetic() && !ch.is_lowercase())
            .unwrap_or(false);
    let shortcut = modifier_participates
        || (modifiers.shift && !shift_letter && !is_shift_character(character));

    Some(KeyPress {
        identity: KeyIdentity {
            id: key_id_string(code.0),
            label,
            is_modifier: false,
        },
        shortcut,
    })
}

pub fn display_key_label(code: u32, character: Option<char>) -> String {
    match code {
        0x0020 => "Space".into(),
        0x000d => "Enter".into(),
        0x0009 => "Tab".into(),
        0x001b => "Esc".into(),
        0x0008 => "Backspace".into(),
        0x007f => "Delete".into(),
        0x0025 => "←".into(),
        0x0026 => "↑".into(),
        0x0027 => "→".into(),
        0x0028 => "↓".into(),
        0x00c0 => "`".into(),
        0x00bd => "-".into(),
        0x00bb => "=".into(),
        0x00db => "[".into(),
        0x00dd => "]".into(),
        0x00ba => ";".into(),
        0x00de => "'".into(),
        0x00dc => "\\".into(),
        0x00bc => ",".into(),
        0x00be => ".".into(),
        0x00bf => "/".into(),
        0x002d => "Insert".into(),
        0x0024 => "Home".into(),
        0x0021 => "PgUp".into(),
        0x0023 => "End".into(),
        0x0022 => "PgDn".into(),
        0x002c => "PrtSc".into(),
        0x0091 => "Scroll".into(),
        0x0013 => "Pause".into(),
        0x0090 => "Num".into(),
        0x006f => "Num /".into(),
        0x006a => "Num *".into(),
        0x006d => "Num -".into(),
        0x006b => "Num +".into(),
        0x006e => "Num .".into(),
        0x006c => "Num Enter".into(),
        0x0060..=0x0069 => format!("Num {}", code - 0x0060),
        0x00e2 => "Intl \\".into(),
        0x0041..=0x005a => char::from_u32(code)
            .map(|ch| ch.to_string())
            .unwrap_or_else(|| key_id_string(code)),
        0x0030..=0x0039 => char::from_u32(code)
            .map(|ch| ch.to_string())
            .unwrap_or_else(|| key_id_string(code)),
        0xf700..=0xf7ff => {
            special_function_label(code).unwrap_or_else(|| format!("F{}", code - 0xf700 + 1))
        }
        _ => character
            .filter(|ch| !ch.is_control())
            .map(|ch| ch.to_uppercase().collect())
            .unwrap_or_else(|| format!("0x{code:02X}")),
    }
}

pub fn key_id_string(code: u32) -> String {
    match code {
        // Modifiers are never counted, but the live keyboard animates them.
        0x0010 => "shift".into(),
        0x00a1 => "shift_right".into(),
        0x0011 => "control".into(),
        0x00a3 => "control_right".into(),
        0x0012 => "alt".into(),
        0x00a5 => "alt_right".into(),
        0x0014 | 0x005b => "meta".into(),
        0x00a7 | 0x005c => "meta_right".into(),
        0x00a0 => "capslock".into(),
        0x00a8 => "fn".into(),
        0xf704..=0xf70f => format!("f{}", code - 0xf703),
        0x0020 => "space".into(),
        0x000d => "enter".into(),
        0x0009 => "tab".into(),
        0x001b => "escape".into(),
        0x0008 => "backspace".into(),
        0x007f => "delete".into(),
        0x0025 => "arrow_left".into(),
        0x0026 => "arrow_up".into(),
        0x0027 => "arrow_right".into(),
        0x0028 => "arrow_down".into(),
        0x00c0 => "backquote".into(),
        0x00bd => "minus".into(),
        0x00bb => "equal".into(),
        0x00db => "bracket_left".into(),
        0x00dd => "bracket_right".into(),
        0x00ba => "semicolon".into(),
        0x00de => "quote".into(),
        0x00dc => "backslash".into(),
        0x00e2 => "intl_backslash".into(),
        0x00bc => "comma".into(),
        0x00be => "period".into(),
        0x00bf => "slash".into(),
        0x002d => "insert".into(),
        0x0024 => "home".into(),
        0x0021 => "pageup".into(),
        0x0023 => "end".into(),
        0x0022 => "pagedown".into(),
        0x002c => "printscreen".into(),
        0x0091 => "scrolllock".into(),
        0x0013 => "pause".into(),
        0x0090 => "numlock".into(),
        0x006f => "numpad_divide".into(),
        0x006a => "numpad_multiply".into(),
        0x006d => "numpad_minus".into(),
        0x006b => "numpad_plus".into(),
        0x006e => "numpad_decimal".into(),
        0x006c => "numpad_enter".into(),
        0x0060..=0x0069 => format!("numpad{}", code - 0x0060),
        0x0041..=0x005a | 0x0030..=0x0039 => char::from_u32(code)
            .unwrap()
            .to_ascii_lowercase()
            .to_string(),
        _ => format!("key_{code:04x}"),
    }
}

pub fn key_code_from_id(id: &str) -> Option<u32> {
    match id {
        "space" => Some(0x0020),
        "enter" => Some(0x000d),
        "tab" => Some(0x0009),
        "escape" => Some(0x001b),
        "backspace" => Some(0x0008),
        "delete" => Some(0x007f),
        "arrow_left" => Some(0x0025),
        "arrow_up" => Some(0x0026),
        "arrow_right" => Some(0x0027),
        "arrow_down" => Some(0x0028),
        "backquote" => Some(0x00c0),
        "minus" => Some(0x00bd),
        "equal" => Some(0x00bb),
        "bracket_left" => Some(0x00db),
        "bracket_right" => Some(0x00dd),
        "semicolon" => Some(0x00ba),
        "quote" => Some(0x00de),
        "backslash" => Some(0x00dc),
        "intl_backslash" => Some(0x00e2),
        "comma" => Some(0x00bc),
        "period" => Some(0x00be),
        "slash" => Some(0x00bf),
        "insert" => Some(0x002d),
        "home" => Some(0x0024),
        "pageup" => Some(0x0021),
        "end" => Some(0x0023),
        "pagedown" => Some(0x0022),
        "printscreen" => Some(0x002c),
        "scrolllock" => Some(0x0091),
        "pause" => Some(0x0013),
        "numlock" => Some(0x0090),
        "numpad_divide" => Some(0x006f),
        "numpad_multiply" => Some(0x006a),
        "numpad_minus" => Some(0x006d),
        "numpad_plus" => Some(0x006b),
        "numpad_decimal" => Some(0x006e),
        "numpad_enter" => Some(0x006c),
        id if id.len() == 1 && id.as_bytes()[0].is_ascii_alphanumeric() => {
            Some(id.as_bytes()[0].to_ascii_uppercase() as u32)
        }
        id if id.starts_with("numpad")
            && id[6..].len() == 1
            && id.as_bytes()[6].is_ascii_digit() =>
        {
            Some(0x0060 + u32::from(id.as_bytes()[6] - b'0'))
        }
        id if id.starts_with('f') => id[1..]
            .parse::<u32>()
            .ok()
            .and_then(|number| (1..=12).contains(&number).then_some(0xf703 + number)),
        id if id.starts_with("key_") => u32::from_str_radix(&id[4..], 16).ok(),
        _ => None,
    }
}

/// Label shown for a stored key id; falls back to the label captured at press time.
pub fn canonical_label(id: &str, fallback: &str) -> String {
    key_code_from_id(id)
        .map(|code| display_key_label(code, None))
        .unwrap_or_else(|| fallback.to_string())
}

pub fn is_modifier(code: u32) -> bool {
    key_kind(code) == KeyKind::Modifier
}

pub fn key_kind(code: u32) -> KeyKind {
    match code {
        0x0010 | 0x0011 | 0x0012 | 0x0014 | 0x005b | 0x005c | 0x005d | 0x00a0..=0x00a8 => {
            KeyKind::Modifier
        }
        0x0020 => KeyKind::Space,
        0x000d | 0x006c => KeyKind::Enter,
        0x0009 => KeyKind::Tab,
        0x001b => KeyKind::Escape,
        0x0008 => KeyKind::Backspace,
        0x007f => KeyKind::Delete,
        0x0025..=0x0028 => KeyKind::Arrow,
        0xf700..=0xf7ff => KeyKind::Function,
        0x0030..=0x0039 | 0x0041..=0x005a => KeyKind::Character,
        _ => KeyKind::Other,
    }
}

fn is_shift_character(character: Option<char>) -> bool {
    character
        .map(|ch| "~!@#$%^&*()_+{}|:\"<>?".contains(ch) && !ch.is_lowercase())
        .unwrap_or(false)
}

fn special_function_label(code: u32) -> Option<String> {
    let label = match code {
        0xf702 => "←",
        0xf703 => "→",
        0xf700 => "↑",
        0xf701 => "↓",
        0xf729 => "Home",
        0xf72b => "End",
        0xf72c => "PgUp",
        0xf72d => "PgDn",
        0xf704..=0xf715 => return Some(format!("F{}", code - 0xf704 + 1)),
        _ => return None,
    };
    Some(label.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mods() -> ModifierSet {
        ModifierSet::default()
    }

    #[test]
    fn modifier_only_press_is_not_counted() {
        assert_eq!(classify_key_press(KeyId(0x0010), None, mods()), None);
    }

    #[test]
    fn shifted_uppercase_letter_is_not_a_shortcut() {
        let result = classify_key_press(
            KeyId(0x0041),
            Some('A'),
            ModifierSet {
                shift: true,
                ..mods()
            },
        )
        .unwrap();
        assert!(!result.shortcut);
        assert_eq!(result.identity.label, "A");
    }

    #[test]
    fn command_letter_is_a_shortcut() {
        let result = classify_key_press(
            KeyId(0x0043),
            Some('c'),
            ModifierSet {
                meta: true,
                ..mods()
            },
        )
        .unwrap();
        assert!(result.shortcut);
    }

    #[test]
    fn shifted_symbol_is_not_a_shortcut() {
        let result = classify_key_press(
            KeyId(0x0021),
            Some('!'),
            ModifierSet {
                shift: true,
                ..mods()
            },
        )
        .unwrap();
        assert!(!result.shortcut);
    }

    #[test]
    fn unknown_key_is_retained() {
        let result = classify_key_press(KeyId(0x1234), None, mods()).unwrap();
        assert_eq!(result.identity.id, "key_1234");
    }

    #[test]
    fn physical_punctuation_has_stable_ids() {
        for (code, id) in [
            (0x001b, "escape"),
            (0x00c0, "backquote"),
            (0x00bd, "minus"),
            (0x00bb, "equal"),
            (0x00db, "bracket_left"),
            (0x00dd, "bracket_right"),
            (0x00ba, "semicolon"),
            (0x00de, "quote"),
            (0x00dc, "backslash"),
            (0x00e2, "intl_backslash"),
            (0x00bc, "comma"),
            (0x00be, "period"),
            (0x00bf, "slash"),
            (0x002c, "printscreen"),
            (0x0091, "scrolllock"),
            (0x0013, "pause"),
            (0x0090, "numlock"),
            (0x002d, "insert"),
            (0x0024, "home"),
            (0x0021, "pageup"),
            (0x007f, "delete"),
            (0x0023, "end"),
            (0x0022, "pagedown"),
            (0x006d, "numpad_minus"),
            (0x006b, "numpad_plus"),
            (0x006a, "numpad_multiply"),
            (0x006f, "numpad_divide"),
            (0x0060, "numpad0"),
            (0x0061, "numpad1"),
            (0x0062, "numpad2"),
            (0x0063, "numpad3"),
            (0x0064, "numpad4"),
            (0x0065, "numpad5"),
            (0x0066, "numpad6"),
            (0x0067, "numpad7"),
            (0x0068, "numpad8"),
            (0x0069, "numpad9"),
            (0x006e, "numpad_decimal"),
            (0x006c, "numpad_enter"),
            (0x000d, "enter"),
            (0xf704, "f1"),
            (0xf70f, "f12"),
        ] {
            let press = classify_key_press(KeyId(code), None, mods()).unwrap();
            assert_eq!(press.identity.id, id, "unexpected id for {code:#06x}");
            assert_eq!(key_code_from_id(id), Some(code));
        }
    }
}
