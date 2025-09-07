import React from 'react';
import CreateJob from '../components/CreateJob';
import JobList from '../components/JobList';

export default function Job() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Управление заявками</h1>
      <CreateJob />
      <JobList />
    </div>
  );
}
