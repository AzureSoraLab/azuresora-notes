
      // Batch independent enhancement hooks into one paint frame. React can
      // replace several UI regions together, so separate observers otherwise
      // repeat the same DOM checks in that frame.
      window.chengmoSchedule = (() => {
        const tasks = new Map();
        let frame = 0;
        return (key, task) => {
          tasks.set(key, task);
          if (frame) return;
          frame = requestAnimationFrame(() => {
            frame = 0;
            const pending = [...tasks.values()];
            tasks.clear();
            pending.forEach(run => run());
          });
        };
      })();
      window.chengmoNotifyUiMounted = () => window.chengmoSchedule('ui-mounted', () => document.dispatchEvent(new CustomEvent('chengmo:ui-mounted')));
      window.chengmoNotifyNoteSelected = () => window.chengmoSchedule('note-selected', () => document.dispatchEvent(new CustomEvent('chengmo:note-selected')));
      document.addEventListener('click', event => {
        if (event.target.closest?.('.compact-note') && !event.target.closest('.compact-note__delete')) window.setTimeout(() => window.chengmoNotifyNoteSelected(), 0);
      }, true);
    