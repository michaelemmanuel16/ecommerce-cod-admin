#!/usr/bin/env python3
"""
Data Transformer Script
-----------------------
Transforms and aggregates raw data for visualization.

Usage:
    python data_transformer.py <operation> --input <file> --output <file> [options]

Operations:
    - aggregate: Group and aggregate data
    - pivot: Pivot table transformation
    - timeseries: Convert to time series format
    - calculate: Calculate derived metrics

Examples:
    # Aggregate sales by date
    python data_transformer.py aggregate --input sales.json --output daily_sales.json --group-by date --sum amount

    # Calculate growth rates
    python data_transformer.py calculate --input sales.json --output growth.json --metric growth_rate --period daily
"""

import json
import sys
import argparse
from datetime import datetime, timedelta
from collections import defaultdict
from typing import List, Dict, Any


def aggregate_data(data: List[Dict], group_by: str, aggregations: Dict[str, str]) -> List[Dict]:
    """
    Aggregate data by grouping key.

    Args:
        data: List of dictionaries containing data
        group_by: Field to group by
        aggregations: Dict of {field: operation} where operation is 'sum', 'avg', 'count', 'min', 'max'

    Returns:
        List of aggregated dictionaries
    """
    groups = defaultdict(lambda: defaultdict(list))

    for item in data:
        key = item.get(group_by)
        if key:
            for field, operation in aggregations.items():
                if field in item:
                    groups[key][field].append(item[field])

    results = []
    for key, values in groups.items():
        result = {group_by: key}
        for field, operation in aggregations.items():
            field_values = values.get(field, [])
            if not field_values:
                result[field] = 0
                continue

            if operation == 'sum':
                result[field] = sum(field_values)
            elif operation == 'avg':
                result[field] = sum(field_values) / len(field_values)
            elif operation == 'count':
                result[field] = len(field_values)
            elif operation == 'min':
                result[field] = min(field_values)
            elif operation == 'max':
                result[field] = max(field_values)
        results.append(result)

    return sorted(results, key=lambda x: x[group_by])


def pivot_data(data: List[Dict], index: str, columns: str, values: str, agg_func: str = 'sum') -> List[Dict]:
    """
    Pivot table transformation.

    Args:
        data: List of dictionaries
        index: Field to use as index (rows)
        columns: Field to pivot into columns
        values: Field to aggregate
        agg_func: Aggregation function ('sum', 'avg', 'count')

    Returns:
        List of pivoted dictionaries
    """
    pivot_dict = defaultdict(lambda: defaultdict(list))

    for item in data:
        idx = item.get(index)
        col = item.get(columns)
        val = item.get(values)
        if idx and col and val is not None:
            pivot_dict[idx][col].append(val)

    results = []
    for idx, cols in pivot_dict.items():
        result = {index: idx}
        for col, vals in cols.items():
            if agg_func == 'sum':
                result[col] = sum(vals)
            elif agg_func == 'avg':
                result[col] = sum(vals) / len(vals)
            elif agg_func == 'count':
                result[col] = len(vals)
        results.append(result)

    return sorted(results, key=lambda x: x[index])


def convert_to_timeseries(data: List[Dict], date_field: str, value_field: str,
                          frequency: str = 'daily') -> List[Dict]:
    """
    Convert data to time series format with regular intervals.

    Args:
        data: List of dictionaries
        date_field: Field containing date/datetime
        value_field: Field to aggregate
        frequency: 'daily', 'weekly', 'monthly'

    Returns:
        List of time series data with regular intervals
    """
    # Parse dates and aggregate
    time_dict = defaultdict(list)

    for item in data:
        date_str = item.get(date_field)
        value = item.get(value_field)
        if date_str and value is not None:
            try:
                dt = datetime.fromisoformat(date_str.replace('Z', '+00:00'))

                if frequency == 'daily':
                    key = dt.strftime('%Y-%m-%d')
                elif frequency == 'weekly':
                    # Start of week (Monday)
                    start_of_week = dt - timedelta(days=dt.weekday())
                    key = start_of_week.strftime('%Y-%m-%d')
                elif frequency == 'monthly':
                    key = dt.strftime('%Y-%m')

                time_dict[key].append(value)
            except (ValueError, AttributeError):
                continue

    # Fill gaps and aggregate
    if not time_dict:
        return []

    results = []
    for date_key, values in sorted(time_dict.items()):
        results.append({
            'date': date_key,
            value_field: sum(values)
        })

    return results


def calculate_growth_rate(data: List[Dict], value_field: str, period: int = 1) -> List[Dict]:
    """
    Calculate growth rate between periods.

    Args:
        data: List of time series dictionaries (must be sorted by date)
        value_field: Field to calculate growth for
        period: Number of periods to look back

    Returns:
        List with added growth_rate field
    """
    results = []

    for i, item in enumerate(data):
        result = item.copy()

        if i >= period:
            current = item[value_field]
            previous = data[i - period][value_field]

            if previous != 0:
                growth = ((current - previous) / previous) * 100
                result['growth_rate'] = round(growth, 2)
            else:
                result['growth_rate'] = 0
        else:
            result['growth_rate'] = 0

        results.append(result)

    return results


def calculate_moving_average(data: List[Dict], value_field: str, window: int = 7) -> List[Dict]:
    """
    Calculate moving average.

    Args:
        data: List of time series dictionaries
        value_field: Field to calculate moving average for
        window: Window size

    Returns:
        List with added moving_average field
    """
    results = []

    for i, item in enumerate(data):
        result = item.copy()

        start_idx = max(0, i - window + 1)
        window_data = data[start_idx:i + 1]
        values = [d[value_field] for d in window_data]

        result['moving_average'] = sum(values) / len(values)
        results.append(result)

    return results


def main():
    parser = argparse.ArgumentParser(description='Transform and aggregate data for visualization')
    parser.add_argument('operation', choices=['aggregate', 'pivot', 'timeseries', 'calculate'],
                       help='Operation to perform')
    parser.add_argument('--input', required=True, help='Input JSON file')
    parser.add_argument('--output', required=True, help='Output JSON file')

    # Aggregate options
    parser.add_argument('--group-by', help='Field to group by')
    parser.add_argument('--sum', help='Field to sum')
    parser.add_argument('--avg', help='Field to average')
    parser.add_argument('--count', help='Field to count')

    # Pivot options
    parser.add_argument('--index', help='Index field for pivot')
    parser.add_argument('--columns', help='Columns field for pivot')
    parser.add_argument('--values', help='Values field for pivot')
    parser.add_argument('--agg-func', default='sum', choices=['sum', 'avg', 'count'],
                       help='Aggregation function for pivot')

    # Time series options
    parser.add_argument('--date-field', help='Date field name')
    parser.add_argument('--value-field', help='Value field name')
    parser.add_argument('--frequency', default='daily', choices=['daily', 'weekly', 'monthly'],
                       help='Time series frequency')

    # Calculate options
    parser.add_argument('--metric', choices=['growth_rate', 'moving_average'],
                       help='Metric to calculate')
    parser.add_argument('--period', type=int, default=1, help='Period for growth rate')
    parser.add_argument('--window', type=int, default=7, help='Window for moving average')

    args = parser.parse_args()

    # Read input data
    try:
        with open(args.input, 'r') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Input file '{args.input}' not found", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in input file: {e}", file=sys.stderr)
        sys.exit(1)

    # Perform operation
    if args.operation == 'aggregate':
        if not args.group_by:
            print("Error: --group-by is required for aggregate operation", file=sys.stderr)
            sys.exit(1)

        aggregations = {}
        if args.sum:
            aggregations[args.sum] = 'sum'
        if args.avg:
            aggregations[args.avg] = 'avg'
        if args.count:
            aggregations[args.count] = 'count'

        if not aggregations:
            print("Error: At least one aggregation (--sum, --avg, --count) is required", file=sys.stderr)
            sys.exit(1)

        result = aggregate_data(data, args.group_by, aggregations)

    elif args.operation == 'pivot':
        if not all([args.index, args.columns, args.values]):
            print("Error: --index, --columns, and --values are required for pivot", file=sys.stderr)
            sys.exit(1)

        result = pivot_data(data, args.index, args.columns, args.values, args.agg_func)

    elif args.operation == 'timeseries':
        if not all([args.date_field, args.value_field]):
            print("Error: --date-field and --value-field are required for timeseries", file=sys.stderr)
            sys.exit(1)

        result = convert_to_timeseries(data, args.date_field, args.value_field, args.frequency)

    elif args.operation == 'calculate':
        if not args.metric:
            print("Error: --metric is required for calculate operation", file=sys.stderr)
            sys.exit(1)

        if not args.value_field:
            print("Error: --value-field is required for calculate operation", file=sys.stderr)
            sys.exit(1)

        if args.metric == 'growth_rate':
            result = calculate_growth_rate(data, args.value_field, args.period)
        elif args.metric == 'moving_average':
            result = calculate_moving_average(data, args.value_field, args.window)

    # Write output
    try:
        with open(args.output, 'w') as f:
            json.dump(result, f, indent=2)
        print(f"✅ Successfully transformed data. Output written to '{args.output}'")
        print(f"   Records processed: {len(data)} → {len(result)}")
    except IOError as e:
        print(f"Error writing output file: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
