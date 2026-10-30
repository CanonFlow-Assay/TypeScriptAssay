// Advice cannot grant a verifier verdict or execute commands.
export const nextInvestigation = (observation) => {
  if (!observation.baselinePassed)
    return Object.freeze({
      kind: 'ContextRequired',
      reason: 'Repair the failed original baseline before mutation interpretation'
    });
  if (!observation.validMutation)
    return Object.freeze({
      kind: 'ContextRequired',
      reason: 'Mutation did not pass syntax validation; it is not a killed mutant'
    });
  if (!observation.completed)
    return Object.freeze({ kind: 'ContextRequired', reason: 'Execution evidence is incomplete' });
  if (!observation.survived)
    return Object.freeze({
      kind: 'NoInvestigation',
      reason: 'Selected tests distinguish this mutation'
    });
  if (observation.budget <= 0) return Object.freeze({ kind: 'BudgetExhausted' });
  if (observation.probeId === 'zero-boundary')
    return Object.freeze({
      kind: 'ProbeRequested',
      probeId: 'zero-boundary',
      reason: 'Run the registered zero-quantity acceptance case'
    });
  return Object.freeze({
    kind: 'SurvivorReview',
    reason: 'A survivor remains unresolved; review the requirement and contract'
  });
};
