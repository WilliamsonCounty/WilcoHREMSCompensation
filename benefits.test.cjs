const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

test('page sections are balanced and salary markup contains two intact fields', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  const stack = [];
  // Check this page's explicit nesting; skip comments and script contents.
  const tags = /<!--[\s\S]*?-->|<script\b[^>]*>[\s\S]*?<\/script\s*>|<\/?([a-z][\w-]*)\b[^>]*>/gi;
  for (const [tag, name] of html.matchAll(tags)) {
    if (!name) continue;
    const lower = name.toLowerCase();
    if (tag.startsWith('</')) assert.equal(stack.pop(), lower, `Unexpected closing tag: ${tag}`);
    else if (!voidTags.has(lower)) stack.push(lower);
  }
  assert.deepEqual(stack, []);
  assert.match(html, /Salary \(Enter either hourly or yearly salary\)\s*<button id="salaryInfoButton"/);
  const salaryGroup = html.slice(html.indexOf('<div id="salaryGroup">'), html.indexOf('<section id="pto"'));
  assert.equal(Array.from(salaryGroup.matchAll(/<input\b/g)).length, 2);
  assert.equal(Array.from(salaryGroup.matchAll(/class="or"/g)).length, 1);
  const sidebar = html.match(/<aside class="rightSidebar">([\s\S]*?)<\/aside>/)[1];
  assert.match(sidebar, /<span id="totalCompensation"[^>]*>\$000\.00<\/span>/);
  assert.match(sidebar, /<canvas id="compensationChart"[^>]*><\/canvas>/);
  assert.doesNotMatch(sidebar, /PTO/);
  assert.match(html, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js@4\.4\.8\/dist\/chart\.umd\.js"><\/script>\s*<script src="benefits\.js\?[^\"]+"><\/script>/);
});

function createApp({ chart = true, missingValidationMessage = false } = {}) {
  const elements = {};
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const elementIds = new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), match => match[1]));
  const get = id => elements[id] || (!elementIds.has(id) || (missingValidationMessage && id === 'validationMessage') ? null : elements[id] = {
    value: id === 'salaryIncrease' ? '0' : '', disabled: false, validity: { badInput: false }, listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    removeAttribute(name) { delete this[name]; },
    setAttribute(name, value) { this[name] = value; },
    insertAdjacentElement(_, element) { elements[element.id] = element; },
    focus() {}, getContext() { return {}; },
  });
  const context = vm.createContext({
    document: { getElementById: get, createElement: () => ({
      setAttribute(name, value) { this[name] = value; },
    }) },
    ...(chart ? { Chart: function (_, config) {
      Object.assign(this, config);
      this.update = () => {};
    } } : {}),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'benefits.js'), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  return {
    get, run,
    salary(source, value) {
      get({ hourly: 'hourlyInput', annual: 'yearlyInput' }[source]).value = value;
      run(`calculate('${source}')`);
    },
    coverage(value) {
      get('medicalCoverage').value = value;
      get('medicalCoverage').listeners.change();
    },
  };
}

test('initial chart shows only salary, retirement, and benefits in three equal slices', () => {
  const app = createApp();
  const data = Array.from(app.run('pieChart.data.datasets[0].data'));
  assert.deepEqual(data, [1, 1, 1]);
  assert.deepEqual(Array.from(app.run('pieChart.data.labels')), ['Salary', 'Retirement', 'Benefits']);
  assert.equal(app.run('pieChart.data.datasets[0].backgroundColor.length'), 3);
  const label = app.run('pieChart.options.plugins.tooltip.callbacks.label');
  assert.equal(label({ parsed: 1, dataset: { data } })[1], '33.3%');
  assert.equal(app.get('totalCompensation').textContent, '—');
  app.salary('hourly', '25');
  app.coverage('Yes');
  assert.deepEqual(Array.from(app.run('pieChart.data.datasets[0].data')), [1, 1, 1]);
});

test('older preview HTML without a validation message still starts and calculates', () => {
  const app = createApp({ missingValidationMessage: true });
  assert.match(app.get('validationMessage').textContent, /Enter a salary/);
  assert.equal(app.get('validationMessage').role, 'status');
  assert.deepEqual(Array.from(app.run('pieChart.data.datasets[0].data')), [1, 1, 1]);
  app.salary('hourly', '25');
  app.coverage('No');
  assert.equal(app.run('setValues()').totalCompensation, 97760);
});

test('blank, negative, nonfinite, and incomplete inputs cannot calculate', () => {
  const app = createApp();
  for (const value of ['', '-25', 'Infinity', 'NaN', '1e308']) {
    app.salary('hourly', value);
    assert.equal(app.run('setValues()'), null);
    assert.equal(app.get('calculateButton').disabled, true);
  }
  app.salary('hourly', '25');
  assert.equal(app.run('setValues()'), null);
  app.coverage('No');
  app.coverage('Yes');
  for (const [plan, covered] of [['hsa', ''], ['', 'coverSelf'], ['', '']]) {
    app.get('medicalPlan').value = plan;
    app.get('medicalCovered').value = covered;
    app.get('medicalPlan').listeners.change();
    assert.equal(app.get('calculateButton').disabled, true);
    assert.equal(app.run('setValues()'), null);
  }
});

test('hourly and annual entries include scheduled overtime and produce the same compensation', () => {
  for (const [source, value] of [['hourly', '25'], ['annual', '83200']]) {
    const app = createApp();
    app.salary(source, value);
    assert.equal(app.get('biweeklyInput'), null);
    assert.equal(app.get('hourlyInput').value, '25' + (source === 'annual' ? '.00' : ''));
    assert.equal(app.get('yearlyInput').value, '83200' + (source === 'hourly' ? '.00' : ''));
    app.coverage('No');
    assert.equal(app.run('setValues()').totalCompensation, 97760);
  }
});

test('pay chart rates convert both ways with rounding only in the displayed field', () => {
  for (const [hourly, annual] of [['19.78', '65827.84'], ['25.31', '84231.68']]) {
    const app = createApp();
    app.get('hourlyInput').value = hourly;
    app.get('hourlyInput').listeners.input();
    assert.equal(app.get('yearlyInput').value, annual);
    app.salary('hourly', '');
    app.get('yearlyInput').value = annual;
    app.get('yearlyInput').listeners.input();
    assert.equal(app.get('hourlyInput').value, hourly);
    assert.equal(app.get('yearlyInput').value, annual);
  }
  const app = createApp();
  app.salary('annual', '65821');
  assert.equal(app.get('hourlyInput').value, '19.78');
  assert.equal(app.run('readSalary().annual'), 65821);
});

test('PTO shows hours without dollar amounts and compensation excludes separate PTO values', () => {
  const app = createApp();
  assert.equal(app.get('floatingHoliday'), null);
  assert.equal(app.get('floatingHolidayTotal'), null);
  app.salary('hourly', '25');
  app.coverage('No');
  const result = app.run('setValues()');
  for (const id of ['vacationTotal', 'sickTotal', 'holidayTotal']) {
    assert.equal(app.get(id), null);
    assert.equal(Object.hasOwn(result, id), false);
  }
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const ptoSection = html.slice(html.indexOf('<section id="pto"'), html.indexOf('<section id="retirement"'));
  assert.doesNotMatch(ptoSection, /\$|dollar amounts|ptoNumbers/);
  for (const hours of [144, 156, 200]) assert.ok(ptoSection.includes(`${hours} hours/year`));
  assert.equal(result.totalCompensation, 97760);
  const data = Array.from(app.run('pieChart.data.datasets[0].data'));
  assert.deepEqual(data.map(value => Number(value.toFixed(2))), [83200, 14560, 0]);
  assert.equal(data.reduce((sum, value) => sum + value, 0), result.totalCompensation);
});

test('raise previews use original pay in both entry units and reset without compounding', () => {
  for (const [source, value] of [['hourly', '25'], ['annual', '83200']]) {
    const app = createApp();
    app.salary(source, value);
    app.coverage('No');
    for (const [percent, hourly, annual] of [['5', '$26.25', '$87,360.00'], ['2.5', '$25.63', '$85,280.00'], ['0', '$25.00', '$83,200.00']]) {
      app.get('salaryIncrease').value = percent;
      app.get('salaryIncrease').listeners.change();
      assert.equal(app.get('raisedHourly').textContent, hourly);
      assert.equal(app.get('raisedAnnual').textContent, annual);
      assert.equal(app.get('totalCompensation').textContent, '—');
      const result = app.run('setValues()');
      const chartData = Array.from(app.run('pieChart.data.datasets[0].data'));
      assert.ok(Math.abs(result.totalCompensation - 97760 * (1 + Number(percent) / 100)) < 0.000001);
      assert.equal(chartData[0], app.run('readPreviewSalary().annual'));
      assert.equal(app.get(source === 'hourly' ? 'hourlyInput' : 'yearlyInput').value, value);
    }
    app.get('salaryIncrease').value = '5';
    app.salary(source, source === 'hourly' ? '30' : '99840');
    assert.equal(app.get('raisedHourly').textContent, '$31.50');
    assert.equal(app.get('raisedAnnual').textContent, '$104,832.00');
    app.salary(source, '');
    assert.equal(app.get('raisedAnnual').textContent, '—');
    assert.equal(app.run('setValues()'), null);
  }
});

test('raise selection validates and medical benefits stay fixed when pay changes', () => {
  const app = createApp();
  app.salary('hourly', '25');
  app.coverage('Yes');
  app.get('medicalPlan').value = 'hsa';
  app.get('medicalCovered').value = 'coverSelf';
  for (const invalid of ['', '-1', 'Infinity', '11', '2.25']) {
    app.get('salaryIncrease').value = invalid;
    app.get('salaryIncrease').listeners.change();
    assert.equal(app.run('setValues()'), null);
    assert.equal(app.get('calculateButton').disabled, true);
  }
  app.get('salaryIncrease').value = '5';
  app.get('salaryIncrease').listeners.change();
  const result = app.run('setValues()');
  assert.equal(result.contributionTotal, 11635.44);
  assert.equal(result.totalCompensation, 102648 + 11635.44);
  app.salary('hourly', '0');
  assert.equal(app.get('raisedHourly').textContent, '$0.00');
  assert.equal(app.run('setValues()').totalCompensation, 11635.44);
});

test('all 12 medical plan amounts remain unchanged', () => {
  const rates = {
    hsa: [[0, 11635.44], [1416.96, 24762.12], [742.56, 22527.72], [1513.2, 36301.32]],
    choice: [[708.96, 8979.96], [2833.92, 18966.24], [1485.24, 17892.72], [3026.4, 28462.8]],
    choicePlus: [[2766, 6952.8], [4591.92, 17275.32], [3529.08, 15908.28], [5400.48, 26185.32]],
  };
  const app = createApp();
  app.salary('hourly', '25');
  app.coverage('Yes');
  for (const [plan, amounts] of Object.entries(rates)) {
    for (const [index, covered] of ['coverSelf', 'coverSpouse', 'coverDependents', 'coverFamily'].entries()) {
      app.get('medicalPlan').value = plan;
      app.get('medicalCovered').value = covered;
      app.get('medicalCovered').listeners.change();
      assert.equal(app.get('calculateButton').disabled, false);
      const result = app.run('setValues()');
      assert.equal(result.premiumTotal, amounts[index][0]);
      assert.equal(result.contributionTotal, amounts[index][1]);
      assert.equal(result.totalCompensation, 97760 + amounts[index][1]);
      const chartData = Array.from(app.run('pieChart.data.datasets[0].data'));
      assert.equal(chartData.length, 3);
      assert.equal(chartData[0], 83200);
      assert.equal(chartData[2], amounts[index][1]);
      assert.ok(Math.abs(chartData.reduce((sum, value) => sum + value, 0) - result.totalCompensation) < 0.000001);
    }
  }
  app.coverage('No');
  assert.equal(app.run('setValues()').contributionTotal, 0);
});

test('editing clears prior estimates and zero salary clears the chart', () => {
  const app = createApp();
  app.salary('hourly', '25');
  app.coverage('No');
  app.run('setValues()');
  app.salary('hourly', '0');
  assert.equal(app.get('totalCompensation').textContent, '—');
  assert.equal(app.run('setValues()').totalCompensation, 0);
  assert.equal(app.run('pieChart.data.datasets[0].data.every(value => value === 0)'), true);
  app.salary('hourly', '');
  assert.equal(app.get('yearlyInput').disabled, false);
  assert.equal(app.get('yearlyInput').value, '');
});

test('chart formatting handles zero and calculations survive an unavailable chart library', () => {
  const app = createApp();
  const label = app.run('pieChart.options.plugins.tooltip.callbacks.label');
  assert.deepEqual(Array.from(label({ parsed: 1234.56, dataset: { data: [1234.56] } })), ['$1,234.56', '100.0%']);
  assert.deepEqual(Array.from(label({ parsed: 0, dataset: { data: [0] } })), ['$0.00', '0.0%']);
  const withoutChart = createApp({ chart: false });
  withoutChart.salary('hourly', '25');
  withoutChart.coverage('No');
  assert.equal(withoutChart.run('setValues()').totalCompensation, 97760);
});
