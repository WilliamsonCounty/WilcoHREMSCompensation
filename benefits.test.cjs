const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function createApp({ chart = true, missingValidationMessage = false } = {}) {
  const elements = {};
  const get = id => missingValidationMessage && id === 'validationMessage' && !elements[id] ? null : elements[id] ||= {
    value: '', disabled: false, validity: { badInput: false }, listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    removeAttribute(name) { delete this[name]; },
    setAttribute(name, value) { this[name] = value; },
    insertAdjacentElement(_, element) { elements[element.id] = element; },
    focus() {}, getContext() { return {}; },
  };
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
      get({ hourly: 'hourlyInput', biweekly: 'biweeklyInput', annual: 'yearlyInput' }[source]).value = value;
      run(`calculate('${source}')`);
    },
    coverage(value) {
      get('medicalCoverage').value = value;
      get('medicalCoverage').listeners.change();
    },
  };
}

test('initial chart shows four equal 25 percent slices', () => {
  const app = createApp();
  const data = Array.from(app.run('pieChart.data.datasets[0].data'));
  assert.deepEqual(data, [1, 1, 1, 1]);
  const label = app.run('pieChart.options.plugins.tooltip.callbacks.label');
  assert.equal(label({ parsed: 1, dataset: { data } })[1], '25.0%');
  assert.equal(app.get('totalCompensation').textContent, '—');
  app.salary('hourly', '25');
  app.coverage('Yes');
  assert.deepEqual(Array.from(app.run('pieChart.data.datasets[0].data')), [1, 1, 1, 1]);
});

test('older preview HTML without a validation message still starts and calculates', () => {
  const app = createApp({ missingValidationMessage: true });
  assert.match(app.get('validationMessage').textContent, /Enter a salary/);
  assert.equal(app.get('validationMessage').role, 'status');
  assert.deepEqual(Array.from(app.run('pieChart.data.datasets[0].data')), [1, 1, 1, 1]);
  app.salary('hourly', '25');
  app.coverage('No');
  assert.equal(app.run('setValues()').totalCompensation, 61100);
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

test('salary entry units produce the same annual compensation', () => {
  for (const [source, value] of [['hourly', '25'], ['biweekly', '2000'], ['annual', '52000']]) {
    const app = createApp();
    app.salary(source, value);
    app.coverage('No');
    assert.equal(app.run('setValues()').totalCompensation, 61100);
  }
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
      assert.equal(result.totalCompensation, 61100 + amounts[index][1]);
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
  assert.equal(app.get('biweeklyInput').disabled, false);
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
  assert.equal(withoutChart.run('setValues()').totalCompensation, 61100);
});
