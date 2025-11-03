#!/usr/bin/env python3
"""
Chart Configuration Generator
------------------------------
Generates Recharts configuration based on data and requirements.

Usage:
    python chart_config.py <chart-type> --data <file> [options]

Chart Types:
    - line: Line chart for trends over time
    - bar: Bar chart for comparisons
    - area: Area chart for cumulative data
    - pie: Pie chart for proportions
    - composed: Combination of multiple chart types

Examples:
    # Generate line chart config
    python chart_config.py line --data sales.json --x-axis date --y-axis sales --title "Sales Trend"

    # Generate bar chart config
    python chart_config.py bar --data reps.json --x-axis name --y-axis revenue --color blue
"""

import json
import sys
import argparse
from typing import Dict, List, Any


def generate_line_chart_config(data: List[Dict], x_axis: str, y_axes: List[str],
                               title: str = "", colors: List[str] = None) -> Dict:
    """Generate Recharts Line chart configuration."""
    if colors is None:
        colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

    config = {
        'type': 'LineChart',
        'data': data,
        'title': title,
        'config': {
            'dataKey': x_axis,
            'lines': []
        }
    }

    for i, y_axis in enumerate(y_axes):
        color = colors[i % len(colors)]
        config['config']['lines'].append({
            'dataKey': y_axis,
            'stroke': color,
            'strokeWidth': 2,
            'dot': {'r': 4},
            'activeDot': {'r': 6}
        })

    return config


def generate_bar_chart_config(data: List[Dict], x_axis: str, y_axes: List[str],
                              title: str = "", colors: List[str] = None,
                              stacked: bool = False) -> Dict:
    """Generate Recharts Bar chart configuration."""
    if colors is None:
        colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

    config = {
        'type': 'BarChart',
        'data': data,
        'title': title,
        'config': {
            'dataKey': x_axis,
            'bars': [],
            'stacked': stacked
        }
    }

    for i, y_axis in enumerate(y_axes):
        color = colors[i % len(colors)]
        config['config']['bars'].append({
            'dataKey': y_axis,
            'fill': color,
            'radius': [8, 8, 0, 0]
        })

    return config


def generate_area_chart_config(data: List[Dict], x_axis: str, y_axes: List[str],
                               title: str = "", colors: List[str] = None,
                               stacked: bool = True) -> Dict:
    """Generate Recharts Area chart configuration."""
    if colors is None:
        colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

    config = {
        'type': 'AreaChart',
        'data': data,
        'title': title,
        'config': {
            'dataKey': x_axis,
            'areas': [],
            'stacked': stacked
        }
    }

    for i, y_axis in enumerate(y_axes):
        color = colors[i % len(colors)]
        config['config']['areas'].append({
            'dataKey': y_axis,
            'fill': color,
            'stroke': color,
            'fillOpacity': 0.6
        })

    return config


def generate_pie_chart_config(data: List[Dict], name_key: str, value_key: str,
                              title: str = "", colors: List[str] = None) -> Dict:
    """Generate Recharts Pie chart configuration."""
    if colors is None:
        colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
                 '#ec4899', '#14b8a6', '#f97316']

    # Transform data for pie chart
    pie_data = []
    for i, item in enumerate(data):
        pie_data.append({
            'name': item.get(name_key, f'Item {i+1}'),
            'value': item.get(value_key, 0),
            'fill': colors[i % len(colors)]
        })

    config = {
        'type': 'PieChart',
        'data': pie_data,
        'title': title,
        'config': {
            'nameKey': 'name',
            'dataKey': 'value',
            'innerRadius': 0,  # Set to >0 for donut chart
            'outerRadius': 80,
            'label': True
        }
    }

    return config


def generate_composed_chart_config(data: List[Dict], x_axis: str,
                                   lines: List[str] = None,
                                   bars: List[str] = None,
                                   areas: List[str] = None,
                                   title: str = "",
                                   colors: List[str] = None) -> Dict:
    """Generate Recharts Composed (combination) chart configuration."""
    if colors is None:
        colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']

    config = {
        'type': 'ComposedChart',
        'data': data,
        'title': title,
        'config': {
            'dataKey': x_axis,
            'components': []
        }
    }

    color_index = 0

    if lines:
        for line_key in lines:
            color = colors[color_index % len(colors)]
            config['config']['components'].append({
                'type': 'Line',
                'dataKey': line_key,
                'stroke': color,
                'strokeWidth': 2
            })
            color_index += 1

    if bars:
        for bar_key in bars:
            color = colors[color_index % len(colors)]
            config['config']['components'].append({
                'type': 'Bar',
                'dataKey': bar_key,
                'fill': color
            })
            color_index += 1

    if areas:
        for area_key in areas:
            color = colors[color_index % len(colors)]
            config['config']['components'].append({
                'type': 'Area',
                'dataKey': area_key,
                'fill': color,
                'stroke': color
            })
            color_index += 1

    return config


def suggest_chart_type(data: List[Dict], x_field: str, y_field: str) -> Dict[str, Any]:
    """
    Suggest appropriate chart type based on data characteristics.

    Args:
        data: Dataset to analyze
        x_field: X-axis field
        y_field: Y-axis field

    Returns:
        Dictionary with chart suggestions
    """
    if not data:
        return {'suggestion': 'No data available'}

    suggestions = []

    # Check if x_field looks like a date
    sample_x = str(data[0].get(x_field, ''))
    is_time_series = any(char in sample_x for char in ['-', '/']) or 'date' in x_field.lower()

    # Check data characteristics
    num_records = len(data)
    unique_x_values = len(set(item.get(x_field) for item in data))

    if is_time_series:
        suggestions.append({
            'type': 'line',
            'reason': 'Time series data - shows trends over time',
            'confidence': 'high'
        })
        suggestions.append({
            'type': 'area',
            'reason': 'Good for showing cumulative trends',
            'confidence': 'medium'
        })

    if unique_x_values < 10 and not is_time_series:
        suggestions.append({
            'type': 'bar',
            'reason': 'Small number of categories - easy to compare',
            'confidence': 'high'
        })
        suggestions.append({
            'type': 'pie',
            'reason': 'Shows proportion of whole (if values are positive)',
            'confidence': 'medium'
        })

    if unique_x_values >= 10 and not is_time_series:
        suggestions.append({
            'type': 'bar',
            'reason': 'Many categories - bars are readable',
            'confidence': 'medium'
        })

    if num_records > 50 and is_time_series:
        suggestions.append({
            'type': 'area',
            'reason': 'Large dataset - area chart shows patterns clearly',
            'confidence': 'high'
        })

    return {
        'data_characteristics': {
            'is_time_series': is_time_series,
            'num_records': num_records,
            'unique_x_values': unique_x_values
        },
        'suggestions': suggestions[:3]  # Return top 3 suggestions
    }


def main():
    parser = argparse.ArgumentParser(description='Generate Recharts configuration')
    parser.add_argument('chart_type',
                       choices=['line', 'bar', 'area', 'pie', 'composed', 'suggest'],
                       help='Chart type to generate')
    parser.add_argument('--data', required=True, help='Input JSON data file')
    parser.add_argument('--output', help='Output configuration file (default: stdout)')

    # Common options
    parser.add_argument('--x-axis', help='X-axis field name')
    parser.add_argument('--y-axis', action='append', help='Y-axis field name (can specify multiple)')
    parser.add_argument('--title', default='', help='Chart title')
    parser.add_argument('--colors', help='Comma-separated color hex codes')

    # Specific options
    parser.add_argument('--stacked', action='store_true', help='Use stacked bars/areas')
    parser.add_argument('--name-key', help='Name field for pie chart')
    parser.add_argument('--value-key', help='Value field for pie chart')
    parser.add_argument('--lines', help='Comma-separated line fields for composed chart')
    parser.add_argument('--bars', help='Comma-separated bar fields for composed chart')
    parser.add_argument('--areas', help='Comma-separated area fields for composed chart')

    args = parser.parse_args()

    # Read data
    try:
        with open(args.data, 'r') as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Error: Data file '{args.data}' not found", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in data file: {e}", file=sys.stderr)
        sys.exit(1)

    # Parse colors if provided
    colors = args.colors.split(',') if args.colors else None

    # Generate configuration
    if args.chart_type == 'suggest':
        if not args.x_axis or not args.y_axis:
            print("Error: --x-axis and --y-axis required for suggestion", file=sys.stderr)
            sys.exit(1)
        result = suggest_chart_type(data, args.x_axis, args.y_axis[0])

    elif args.chart_type == 'line':
        if not args.x_axis or not args.y_axis:
            print("Error: --x-axis and --y-axis required for line chart", file=sys.stderr)
            sys.exit(1)
        result = generate_line_chart_config(data, args.x_axis, args.y_axis, args.title, colors)

    elif args.chart_type == 'bar':
        if not args.x_axis or not args.y_axis:
            print("Error: --x-axis and --y-axis required for bar chart", file=sys.stderr)
            sys.exit(1)
        result = generate_bar_chart_config(data, args.x_axis, args.y_axis, args.title, colors, args.stacked)

    elif args.chart_type == 'area':
        if not args.x_axis or not args.y_axis:
            print("Error: --x-axis and --y-axis required for area chart", file=sys.stderr)
            sys.exit(1)
        result = generate_area_chart_config(data, args.x_axis, args.y_axis, args.title, colors, args.stacked)

    elif args.chart_type == 'pie':
        if not args.name_key or not args.value_key:
            print("Error: --name-key and --value-key required for pie chart", file=sys.stderr)
            sys.exit(1)
        result = generate_pie_chart_config(data, args.name_key, args.value_key, args.title, colors)

    elif args.chart_type == 'composed':
        if not args.x_axis:
            print("Error: --x-axis required for composed chart", file=sys.stderr)
            sys.exit(1)
        lines = args.lines.split(',') if args.lines else None
        bars = args.bars.split(',') if args.bars else None
        areas = args.areas.split(',') if args.areas else None
        result = generate_composed_chart_config(data, args.x_axis, lines, bars, areas, args.title, colors)

    # Output result
    output_json = json.dumps(result, indent=2)

    if args.output:
        try:
            with open(args.output, 'w') as f:
                f.write(output_json)
            print(f"✅ Chart configuration generated: '{args.output}'")
        except IOError as e:
            print(f"Error writing output file: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        print(output_json)


if __name__ == '__main__':
    main()
