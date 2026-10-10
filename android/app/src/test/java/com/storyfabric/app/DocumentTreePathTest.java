package com.storyfabric.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import java.io.IOException;
import java.util.Arrays;
import org.junit.Test;

public class DocumentTreePathTest {
    @Test
    public void acceptsNestedChapterAndMetadataPaths() throws IOException {
        assertEquals(Arrays.asList("chapters", "draft", "0001-第一章.md"), DocumentTreePath.segments("chapters/draft/0001-第一章.md", true, false));
        assertEquals(Arrays.asList(".storyfabric", "writing-stats", "current.json"), DocumentTreePath.segments(".storyfabric/writing-stats/current.json", true, false));
    }

    @Test
    public void keepsWorkspaceRootRestrictedToOneDirectory() throws IOException {
        assertEquals(Arrays.asList("我的小说"), DocumentTreePath.segments("我的小说", true, true));
        assertEquals(0, DocumentTreePath.segments("", true, true).size());
        assertThrows(IOException.class, () -> DocumentTreePath.segments("novels/project", true, true));
    }

    @Test
    public void rejectsTraversalAndMalformedPaths() {
        for (String path : new String[] { "../chapter.md", "chapters/../other", "chapters/./file", "/chapters/file", "chapters\\file", "chapters//file", "chapters/", "file\0name" }) {
            assertThrows(IOException.class, () -> DocumentTreePath.segments(path, true, false));
        }
        assertThrows(IOException.class, () -> DocumentTreePath.segments("", false, false));
    }
}
