import { describe, expect, it } from 'vitest';
import { productName } from './format';

describe('productName', () => {
  it.each([
    ['AmazonBasics Classic, Adjustable, Swivel Office Desk Chair with Casters and Twill Fabric, Navy', 'AmazonBasics', 'Swivel Office Desk Chair'],
    ['Rivet Mid-Century Desk, 42"W, Warm Brown Wood with Veneer', 'Rivet', 'Mid-Century Desk'],
    ['Amazon Basics - 4\'X6\' Plush Diamond Trellis Shag Rug, Grey', 'Amazon Basics', '4\'X6\' Plush Diamond Trellis Shag Rug'],
    ['Solimo Aquilla Engineered Wood Bedside Table with Drawer (Wenge Finish)', 'Amazon Brand - Solimo', 'Aquilla Engineered Wood Bedside Table'],
    ['Movian Andre Accent Chair - Light Grey', 'Movian', 'Andre Accent Chair'],
    ['Amazon Brand Movian Emme, Bedside Table, 40 x 40 x 45 cm (L x W x H), White', 'Amazon Brand - Movian', 'Bedside Table'],
    ['Stone & Beam Round Battery Operated Vintage Decorative Wall Clock - 23 Inch, Black Wood', 'Stone & Beam', 'Round Battery Operated Vintage Decorative Wall Clock'],
    ['Calathea Orbifolia Plant in Terracotta Pot', undefined, 'Calathea Orbifolia Plant in Terracotta Pot'],
    ['UMI Gaming Chair Office Chair with Footrests Gamer Swivel Chair', undefined, 'UMI Gaming Chair Office Chair'],
  ])('%s', (title, brand, name) => {
    expect(productName({ title, brand })).toBe(name);
  });

  it('keeps a title it would otherwise empty', () => {
    expect(productName({ title: 'Rivet', brand: 'Rivet' })).toBe('Rivet');
    expect(productName({ title: 'Lamp' })).toBe('Lamp');
  });
});
