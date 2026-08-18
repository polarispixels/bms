import type { Motion } from './types'

/**
 * Pushes a motion onto the stack.
 * - MAIN motions go at the bottom; a new MAIN pushes any existing MAIN up.
 * - AMEND motions go on top of the stack.
 * - Throws if AMEND is pushed onto empty stack.
 * - Throws if stack depth would exceed 3 after push.
 * Immutable: returns a new array.
 */
export function pushMotion(stack: Motion[], m: Motion): Motion[] {
  if (m.kind === 'AMEND' && stack.length === 0) {
    throw new Error('Cannot push AMEND motion onto empty stack')
  }

  if (stack.length >= 3) {
    throw new Error('Motion stack depth cannot exceed 3')
  }

  if (m.kind === 'MAIN') {
    // New main goes at the bottom; existing main(s) and amendments shift up
    return [m, ...stack]
  } else {
    // AMEND goes on top
    return [...stack, m]
  }
}

/**
 * Returns the top motion on the stack, or null if empty.
 */
export function topMotion(stack: Motion[]): Motion | null {
  if (stack.length === 0) {
    return null
  }
  return stack[stack.length - 1]
}

/**
 * Pops and returns the top motion.
 * Throws if stack is empty.
 * Immutable: returns new stack in result.
 */
export function popMotion(stack: Motion[]): { stack: Motion[]; popped: Motion } {
  if (stack.length === 0) {
    throw new Error('Cannot pop from empty motion stack')
  }
  const popped = stack[stack.length - 1]
  const newStack = stack.slice(0, -1)
  return { stack: newStack, popped }
}

/**
 * Returns true if motion is debatable.
 * MVP: MAIN and AMEND are both debatable.
 */
export function isDebatable(m: Motion): boolean {
  return m.kind === 'MAIN' || m.kind === 'AMEND'
}

/**
 * Returns the vote threshold for a motion.
 * MVP: all motions require majority.
 */
export function voteThreshold(m: Motion): 'MAJORITY' {
  return 'MAJORITY'
}
