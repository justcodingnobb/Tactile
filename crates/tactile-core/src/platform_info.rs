use crate::models::Point;

pub trait ScreenInfo: Send + Sync {
    fn main_screen_size(&self) -> (f64, f64);
    fn cursor_position(&self) -> Option<Point>;
}

#[derive(Clone, Copy, Debug)]
pub struct FixedScreenInfo {
    pub size: (f64, f64),
    pub cursor: Option<Point>,
}

impl ScreenInfo for FixedScreenInfo {
    fn main_screen_size(&self) -> (f64, f64) {
        self.size
    }

    fn cursor_position(&self) -> Option<Point> {
        self.cursor
    }
}
