package com.storyfabric.app;

import static org.junit.Assert.assertEquals;
import org.junit.Test;

public class WritingKeyboardLayoutTest {
    @Test
    public void overlayKeyboardClipsOnlyTheObscuredPart() {
        assertEquals(600, WritingKeyboardLayout.visibleHeight(950, 50, 650));
    }

    @Test
    public void alreadyResizedWebViewDoesNotSubtractKeyboardHeightAgain() {
        assertEquals(600, WritingKeyboardLayout.visibleHeight(600, 50, 650));
    }

    @Test
    public void respectsWindowAndStatusBarOffsets() {
        assertEquals(550, WritingKeyboardLayout.visibleHeight(850, 200, 750));
    }

    @Test
    public void floatingKeyboardDoesNotExpandTheWebView() {
        assertEquals(600, WritingKeyboardLayout.visibleHeight(600, 50, 1000));
    }

    @Test
    public void neverReturnsNegativeSpace() {
        assertEquals(0, WritingKeyboardLayout.visibleHeight(600, 700, 650));
    }
}
