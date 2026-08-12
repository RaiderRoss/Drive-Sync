#[derive(Clone, Copy)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[allow(dead_code)]
pub enum Colour {
    Red,
    Green,
    Blue,
    Yellow,
    Magenta,
    Cyan,
    White,
    Black,
    Gray,
    DarkRed,
    DarkGreen,
    DarkBlue,
}

impl Colour {
    pub fn rgb(&self) -> Rgb {
        match self {
            Colour::Red => Rgb { r: 255, g: 0, b: 0 },
            Colour::Green => Rgb { r: 0, g: 255, b: 0 },
            Colour::Yellow => Rgb {
                r: 255,
                g: 255,
                b: 0,
            },
            Colour::Blue => Rgb { r: 0, g: 0, b: 255 },
            Colour::Magenta => Rgb {
                r: 255,
                g: 0,
                b: 255,
            },
            Colour::Cyan => Rgb {
                r: 0,
                g: 255,
                b: 255,
            },
            Colour::White => Rgb {
                r: 255,
                g: 255,
                b: 255,
            },
            Colour::Black => Rgb { r: 0, g: 0, b: 0 },
            Colour::Gray => Rgb {
                r: 128,
                g: 128,
                b: 128,
            },
            Colour::DarkRed => Rgb { r: 128, g: 0, b: 0 },
            Colour::DarkGreen => Rgb { r: 0, g: 128, b: 0 },
            Colour::DarkBlue => Rgb { r: 0, g: 0, b: 128 },
        }
    }
}

#[macro_export]
macro_rules! print {
    ($colour:expr, $($arg:tt)*) => {{
        let rgb = $colour.rgb();
        ::std::print!(
            "\x1b[38;2;{};{};{}m{}\x1b[0m",
            rgb.r,
            rgb.g,
            rgb.b,
            format_args!($($arg)*)
        );
    }};
}

#[macro_export]
macro_rules! println {
    ($colour:expr, $($arg:tt)*) => {{
        let rgb = $colour.rgb();
        ::std::println!(
            "\x1b[38;2;{};{};{}m{}\x1b[0m",
            rgb.r,
            rgb.g,
            rgb.b,
            format_args!($($arg)*)
        );
    }};
}
