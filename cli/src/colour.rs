//! Terminal color utilities.
//!
//! Provides predefined colors, RGB color representations, and macros
//! for printing colored text to the terminal using ANSI escape sequences.

/// Represents an RGB (red, green, blue) color.
///
/// Each color component is stored as an unsigned 8-bit integer (`u8`),
/// ranging from `0` to `255`.
///
/// # Examples
///
/// ```
/// let color = Rgb {
///     r: 255,
///     g: 128,
///     b: 0,
/// };
/// ```
#[derive(Clone, Copy)]
pub struct Rgb {
    /// The red color component, ranging from `0` to `255`.
    pub r: u8,

    /// The green color component, ranging from `0` to `255`.
    pub g: u8,

    /// The blue color component, ranging from `0` to `255`.
    pub b: u8,
}

/// Represents a predefined terminal text color.
///
/// The variants correspond to commonly used ANSI terminal colors.
/// Each variant can be converted into its corresponding [`Rgb`] value
/// using [`Colour::rgb`].
#[allow(dead_code)]
pub enum Colour {
    /// Standard red.
    Red,

    /// Standard green.
    Green,

    /// Standard blue.
    Blue,

    /// Yellow, combining full red and green components.
    Yellow,

    /// Magenta, combining full red and blue components.
    Magenta,

    /// Cyan, combining full green and blue components.
    Cyan,

    /// White, with all RGB components set to `255`.
    White,

    /// Black, with all RGB components set to `0`.
    Black,

    /// Medium gray, with all RGB components set to `128`.
    Gray,

    /// Dark red.
    DarkRed,

    /// Dark green.
    DarkGreen,

    /// Dark blue.
    DarkBlue,
}

impl Colour {
    /// Returns the RGB representation of this color.
    ///
    /// # Returns
    ///
    /// An [`Rgb`] value containing the red, green, and blue components
    /// corresponding to this [`Colour`] variant.
    ///
    /// # Examples
    ///
    /// ```
    /// let colour = Colour::Red;
    /// let rgb = colour.rgb();
    ///
    /// assert_eq!(rgb.r, 255);
    /// assert_eq!(rgb.g, 0);
    /// assert_eq!(rgb.b, 0);
    /// ```
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

/// Prints formatted text to standard output using the specified color.
///
/// The macro applies the supplied [`Colour`] using a 24-bit ANSI escape
/// sequence and resets the terminal color after the text has been printed.
///
/// # Arguments
///
/// * `$colour` - A [`Colour`] value specifying the text color.
/// * `$($arg:tt)*` - A format string and its arguments, following the same
///   syntax as [`std::print!`].
///
/// # Examples
///
/// ```
/// print!(Colour::Red, "Error: {}", "something went wrong");
/// ```
///
/// This produces red text in terminals that support 24-bit ANSI colors.
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

/// Prints formatted text followed by a newline using the specified color.
///
/// The macro applies the supplied [`Colour`] using a 24-bit ANSI escape
/// sequence and resets the terminal color after the text has been printed.
///
/// # Arguments
///
/// * `$colour` - A [`Colour`] value specifying the text color.
/// * `$($arg:tt)*` - A format string and its arguments, following the same
///   syntax as [`std::println!`].
///
/// # Examples
///
/// ```
/// println!(Colour::Green, "Success: {}", "operation completed");
/// ```
///
/// This produces green text followed by a newline in terminals that
/// support 24-bit ANSI colors.
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