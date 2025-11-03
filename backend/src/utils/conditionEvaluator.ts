import logger from './logger';

/**
 * Supported comparison operators for condition evaluation
 */
export type ConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equal'
  | 'less_than_or_equal'
  | 'contains'
  | 'not_contains'
  | 'starts_with'
  | 'ends_with'
  | 'in'
  | 'not_in'
  | 'is_empty'
  | 'is_not_empty';

/**
 * Logic operators for combining multiple rules
 */
export type LogicOperator = 'AND' | 'OR';

/**
 * Single condition rule
 */
export interface ConditionRule {
  field: string;
  operator: ConditionOperator;
  value?: any;
}

/**
 * Group of conditions with logic operator
 */
export interface ConditionGroup {
  logic: LogicOperator;
  rules: (ConditionRule | ConditionGroup)[];
}

/**
 * Main condition structure
 */
export type Conditions = ConditionGroup;

/**
 * Condition Evaluator Utility
 * Evaluates complex conditions with support for AND/OR logic and various operators
 */

/**
 * Evaluate a single rule against actual value
 *
 * @param actual - Actual value from context
 * @param operator - Comparison operator
 * @param expected - Expected value to compare against
 * @returns True if condition is met, false otherwise
 */
export function evaluateRule(actual: any, operator: ConditionOperator, expected?: any): boolean {
  try {
    switch (operator) {
      case 'equals':
        return actual === expected;

      case 'not_equals':
        return actual !== expected;

      case 'greater_than':
        if (typeof actual !== 'number' || typeof expected !== 'number') {
          return false;
        }
        return actual > expected;

      case 'less_than':
        if (typeof actual !== 'number' || typeof expected !== 'number') {
          return false;
        }
        return actual < expected;

      case 'greater_than_or_equal':
        if (typeof actual !== 'number' || typeof expected !== 'number') {
          return false;
        }
        return actual >= expected;

      case 'less_than_or_equal':
        if (typeof actual !== 'number' || typeof expected !== 'number') {
          return false;
        }
        return actual <= expected;

      case 'contains':
        if (typeof actual === 'string' && typeof expected === 'string') {
          return actual.toLowerCase().includes(expected.toLowerCase());
        }
        if (Array.isArray(actual)) {
          return actual.includes(expected);
        }
        return false;

      case 'not_contains':
        if (typeof actual === 'string' && typeof expected === 'string') {
          return !actual.toLowerCase().includes(expected.toLowerCase());
        }
        if (Array.isArray(actual)) {
          return !actual.includes(expected);
        }
        return true;

      case 'starts_with':
        if (typeof actual !== 'string' || typeof expected !== 'string') {
          return false;
        }
        return actual.toLowerCase().startsWith(expected.toLowerCase());

      case 'ends_with':
        if (typeof actual !== 'string' || typeof expected !== 'string') {
          return false;
        }
        return actual.toLowerCase().endsWith(expected.toLowerCase());

      case 'in':
        if (!Array.isArray(expected)) {
          return false;
        }
        return expected.includes(actual);

      case 'not_in':
        if (!Array.isArray(expected)) {
          return true;
        }
        return !expected.includes(actual);

      case 'is_empty':
        if (actual === null || actual === undefined) {
          return true;
        }
        if (typeof actual === 'string') {
          return actual.trim() === '';
        }
        if (Array.isArray(actual)) {
          return actual.length === 0;
        }
        if (typeof actual === 'object') {
          return Object.keys(actual).length === 0;
        }
        return false;

      case 'is_not_empty':
        return !evaluateRule(actual, 'is_empty');

      default:
        logger.warn('Unknown operator in condition evaluation', { operator });
        return false;
    }
  } catch (error: any) {
    logger.error('Error evaluating rule', {
      operator,
      actual,
      expected,
      error: error.message
    });
    return false;
  }
}

/**
 * Get nested value from object using dot notation
 *
 * @param obj - Object to get value from
 * @param path - Dot-separated path (e.g., 'customer.totalOrders')
 * @returns Value at path or undefined if not found
 */
function getNestedValue(obj: any, path: string): any {
  if (!obj || typeof obj !== 'object') {
    return undefined;
  }

  const keys = path.split('.');
  let value = obj;

  for (const key of keys) {
    if (value === null || value === undefined) {
      return undefined;
    }
    value = value[key];
  }

  return value;
}

/**
 * Evaluate a single condition rule
 *
 * @param rule - Condition rule to evaluate
 * @param context - Context object containing data to evaluate against
 * @returns True if rule is satisfied, false otherwise
 */
function evaluateSingleRule(rule: ConditionRule, context: any): boolean {
  const actual = getNestedValue(context, rule.field);

  const result = evaluateRule(actual, rule.operator, rule.value);

  logger.debug('Rule evaluated', {
    field: rule.field,
    operator: rule.operator,
    expected: rule.value,
    actual,
    result
  });

  return result;
}

/**
 * Check if an item is a ConditionGroup
 */
function isConditionGroup(item: ConditionRule | ConditionGroup): item is ConditionGroup {
  return 'logic' in item && 'rules' in item;
}

/**
 * Evaluate a condition group (recursive)
 *
 * @param group - Condition group to evaluate
 * @param context - Context object containing data to evaluate against
 * @returns True if all conditions are met according to logic operator
 */
function evaluateConditionGroup(group: ConditionGroup, context: any): boolean {
  if (!group.rules || group.rules.length === 0) {
    return true;
  }

  const results: boolean[] = [];

  for (const item of group.rules) {
    let result: boolean;

    if (isConditionGroup(item)) {
      // Recursively evaluate nested group
      result = evaluateConditionGroup(item, context);
    } else {
      // Evaluate single rule
      result = evaluateSingleRule(item, context);
    }

    results.push(result);

    // Short-circuit evaluation for performance
    if (group.logic === 'AND' && !result) {
      return false;
    }
    if (group.logic === 'OR' && result) {
      return true;
    }
  }

  // Return final result based on logic operator
  if (group.logic === 'AND') {
    return results.every(r => r);
  } else {
    return results.some(r => r);
  }
}

/**
 * Evaluate conditions against a context object
 *
 * @param conditions - Conditions to evaluate (can be null/undefined for no conditions)
 * @param context - Context object containing data to evaluate against
 * @returns True if conditions are met, false otherwise
 */
export function evaluateConditions(conditions: Conditions | null | undefined, context: any): boolean {
  // No conditions means always pass
  if (!conditions) {
    return true;
  }

  try {
    const result = evaluateConditionGroup(conditions, context);

    logger.info('Conditions evaluated', {
      result,
      conditionCount: conditions.rules?.length || 0
    });

    return result;
  } catch (error: any) {
    logger.error('Error evaluating conditions', {
      error: error.message,
      conditions,
      context
    });
    return false;
  }
}

/**
 * Validate condition structure
 *
 * @param conditions - Conditions to validate
 * @returns Validation result with errors if any
 */
export function validateConditions(conditions: any): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!conditions) {
    return { valid: true, errors: [] };
  }

  if (typeof conditions !== 'object') {
    errors.push('Conditions must be an object');
    return { valid: false, errors };
  }

  function validateGroup(group: any, path: string = 'root'): void {
    if (!group.logic || !['AND', 'OR'].includes(group.logic)) {
      errors.push(`${path}: logic must be either 'AND' or 'OR'`);
    }

    if (!Array.isArray(group.rules)) {
      errors.push(`${path}: rules must be an array`);
      return;
    }

    group.rules.forEach((rule: any, index: number) => {
      const rulePath = `${path}.rules[${index}]`;

      if ('logic' in rule && 'rules' in rule) {
        // Nested group
        validateGroup(rule, rulePath);
      } else {
        // Single rule
        if (!rule.field || typeof rule.field !== 'string') {
          errors.push(`${rulePath}: field must be a string`);
        }

        const validOperators: ConditionOperator[] = [
          'equals',
          'not_equals',
          'greater_than',
          'less_than',
          'greater_than_or_equal',
          'less_than_or_equal',
          'contains',
          'not_contains',
          'starts_with',
          'ends_with',
          'in',
          'not_in',
          'is_empty',
          'is_not_empty'
        ];

        if (!rule.operator || !validOperators.includes(rule.operator)) {
          errors.push(`${rulePath}: operator must be one of: ${validOperators.join(', ')}`);
        }

        // Check if value is required for operator
        const operatorsWithoutValue = ['is_empty', 'is_not_empty'];
        if (!operatorsWithoutValue.includes(rule.operator) && rule.value === undefined) {
          errors.push(`${rulePath}: value is required for operator '${rule.operator}'`);
        }
      }
    });
  }

  validateGroup(conditions);

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Helper function to create simple condition
 *
 * @param field - Field to check
 * @param operator - Comparison operator
 * @param value - Value to compare against
 * @returns Condition group with single rule
 */
export function createSimpleCondition(
  field: string,
  operator: ConditionOperator,
  value?: any
): Conditions {
  return {
    logic: 'AND',
    rules: [{ field, operator, value }]
  };
}

/**
 * Helper function to combine multiple conditions with AND
 *
 * @param rules - Array of condition rules
 * @returns Condition group with AND logic
 */
export function createAndCondition(rules: ConditionRule[]): Conditions {
  return {
    logic: 'AND',
    rules
  };
}

/**
 * Helper function to combine multiple conditions with OR
 *
 * @param rules - Array of condition rules
 * @returns Condition group with OR logic
 */
export function createOrCondition(rules: ConditionRule[]): Conditions {
  return {
    logic: 'OR',
    rules
  };
}
