/* Preserve notes written by the accidental legacy build before restoring the reader. */
(() => {
  const marker = 'azuresora-legacy-notes-imported-v1';
  try {
    if (localStorage.getItem(marker)) return;
    const legacy = JSON.parse(localStorage.getItem('chengmo-notes-v3') || 'null');
    if (!Array.isArray(legacy?.notes) || !Array.isArray(legacy?.categories)) return;
    const current = JSON.parse(localStorage.getItem('chengmo-notes-v1') || 'null');
    if (current && (!Array.isArray(current.courses) || !Array.isArray(current.notes))) return;
    const state = current || { courses: [], notes: [] };
    const courses = new Set(state.courses.map(course => course.id));
    for (const category of legacy.categories) {
      if (!category?.id || courses.has(category.id)) continue;
      state.courses.push({ ...category, chapters: [] });
      courses.add(category.id);
    }
    const notes = new Set(state.notes.map(note => note.id));
    const marks = JSON.parse(localStorage.getItem('chengmo-text-selection-annotations-v1') || '[]');
    if (!Array.isArray(marks)) return;
    const markIds = new Set(marks.map(mark => mark.id));
    for (const note of legacy.notes) {
      if (!note?.id || notes.has(note.id)) continue;
      const timestamp = note.updatedAt || new Date().toISOString();
      state.notes.push({ ...note, courseId: note.categoryId || null, chapterId: null,
        tags: Array.isArray(note.tags) ? note.tags : [], createdAt: note.createdAt || timestamp,
        updatedAt: timestamp, favorite: Boolean(note.favorite), completed: Boolean(note.completed) });
      notes.add(note.id);
      for (const annotation of note.annotations || []) {
        const id = `legacy-${note.id}-${annotation.id}`;
        if (markIds.has(id)) continue;
        marks.push({ ...annotation, id, noteId: note.id, text: annotation.quote,
          comment: annotation.comment || '', tags: annotation.tags || [] });
        markIds.add(id);
      }
    }
    // Keep the legacy store intact. Mark success only after both writes succeed.
    localStorage.setItem('chengmo-text-selection-annotations-v1', JSON.stringify(marks));
    localStorage.setItem('chengmo-notes-v1', JSON.stringify(state));
    localStorage.setItem(marker, '1');
  } catch (error) {
    console.warn('Legacy notes import was deferred; original data is preserved.', error);
  }
})();
