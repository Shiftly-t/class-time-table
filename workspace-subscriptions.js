// A session can restart its listeners while keeping the same user and workspace.
export function createWorkspaceSubscriptions(onSnapshot, sessionGuard) {
  let generation = 0;
  let unsubscribers = [];

  function subscribe(ref, onValue, onError) {
    const currentSession = sessionGuard();
    const activeGeneration = generation;
    const guard = handler => value => {
      if (activeGeneration === generation && currentSession()) handler(value);
    };
    unsubscribers.push(onSnapshot(ref, guard(onValue), guard(onError)));
  }

  function clear() {
    generation++;
    const previous = unsubscribers;
    unsubscribers = [];
    for (const unsubscribe of previous) {
      try {
        unsubscribe();
      } catch (error) {
        console.warn('購読を解除できませんでした', error);
      }
    }
  }

  return { subscribe, clear };
}
