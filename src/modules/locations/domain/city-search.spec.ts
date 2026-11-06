import { searchCities } from './city-search.js';
import type { CityRecord } from './dtos/repositories/location.repository.js';
import { toSearchName } from './location-names.js';

const city = (name: string, aliases: string[] = []): CityRecord => ({
  ibgeCode: 1,
  name,
  uf: 'RJ',
  searchName: toSearchName(name),
  aliases,
});

const names = (cities: readonly CityRecord[]) => cities.map(({ name }) => name);

describe('searchCities', () => {
  const cities = [
    city('Paraty', ['PARATI']),
    city('Teresópolis'),
    city('São João de Meriti'),
    city('Rio de Janeiro'),
    city('Niterói'),
  ];

  it('sem trecho, devolve todos em ordem alfabética', () => {
    const list = names(searchCities(cities, undefined));

    expect(list).toEqual([
      'Niterói',
      'Paraty',
      'Rio de Janeiro',
      'São João de Meriti',
      'Teresópolis',
    ]);
    expect(names(searchCities(cities, ' - '))).toEqual(list);
  });

  it('não distingue acento nem caixa', () => {
    expect(names(searchCities(cities, 'NITERÓI'))).toEqual(['Niterói']);
    expect(names(searchCities(cities, 'niteroi'))).toEqual(['Niterói']);
    expect(names(searchCities(cities, 'sao joao'))).toEqual([
      'São João de Meriti',
    ]);
  });

  it('acha o trecho no meio do nome', () => {
    expect(names(searchCities(cities, 'esop'))).toEqual(['Teresópolis']);
  });

  it('põe quem começa pelo trecho antes de quem só o contém', () => {
    const list = [
      city('Paracambi'),
      city('Bom Jesus do Paraíso'),
      city('Upara'),
    ];

    expect(names(searchCities(list, 'para'))).toEqual([
      'Paracambi',
      'Bom Jesus do Paraíso',
      'Upara',
    ]);
  });

  it('chega ao município pela grafia de outra fonte, depois dos nomes', () => {
    const list = [city('Paraty', ['PARATI']), city('Aparatinga')];

    expect(names(searchCities(list, 'parati'))).toEqual([
      'Aparatinga',
      'Paraty',
    ]);
  });

  it('sem correspondência, a lista fica vazia', () => {
    expect(searchCities(cities, 'zzz')).toEqual([]);
  });
});
